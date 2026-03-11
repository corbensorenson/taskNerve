import { stat } from "node:fs/promises";

import { SCHEMA_PROJECTS, nowIsoUtc } from "../constants.js";
import { projectRegistrySchema, type ProjectRegistry } from "../schemas.js";
import { readJsonOptionalWithRaw, writePrettyJsonIfChanged } from "./jsonStore.js";
import { taskNerveProjectsRegistryPath } from "./paths.js";

const FILE_MISSING_MTIME_MS = -1;

interface ProjectRegistryCacheEntry {
  mtimeMs: number;
  value: ProjectRegistry;
}

const projectRegistryCache = new Map<string, ProjectRegistryCacheEntry>();
const projectRegistryInflight = new Map<string, Promise<ProjectRegistry>>();

async function fileMtimeMs(filePath: string): Promise<number> {
  try {
    const metadata = await stat(filePath);
    return metadata.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return FILE_MISSING_MTIME_MS;
    }
    throw error;
  }
}

export async function loadProjectRegistry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRegistry> {
  const filePath = taskNerveProjectsRegistryPath(env);
  const inflight = projectRegistryInflight.get(filePath);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = projectRegistryCache.get(filePath);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      return cached.value;
    }

    const { value: current, raw } = await readJsonOptionalWithRaw(filePath, projectRegistrySchema);
    const normalized = projectRegistrySchema.parse(
      current || {
        schema_version: SCHEMA_PROJECTS,
        updated_at_utc: nowIsoUtc(),
        default_project: null,
        projects: [],
      },
    );
    normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
    const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw: raw });
    const nextMtimeMs =
      wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
    projectRegistryCache.set(filePath, {
      mtimeMs: nextMtimeMs,
      value: normalized,
    });
    return normalized;
  })();

  projectRegistryInflight.set(filePath, promise);
  return promise.finally(() => {
    projectRegistryInflight.delete(filePath);
  });
}

export async function writeProjectRegistry(
  registry: ProjectRegistry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRegistry> {
  const filePath = taskNerveProjectsRegistryPath(env);
  const normalized = projectRegistrySchema.parse(registry);
  normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
  await writePrettyJsonIfChanged(filePath, normalized);
  const nextMtimeMs = await fileMtimeMs(filePath);
  projectRegistryCache.set(filePath, {
    mtimeMs: nextMtimeMs,
    value: normalized,
  });
  return normalized;
}
