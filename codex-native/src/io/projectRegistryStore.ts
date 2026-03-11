import { stat } from "node:fs/promises";

import { SCHEMA_PROJECTS, nowIsoUtc } from "../constants.js";
import { projectRegistrySchema, type ProjectRegistry } from "../schemas.js";
import {
  formatPrettyJson,
  readJsonOptionalWithRaw,
  writePrettyJsonIfChanged,
} from "./jsonStore.js";
import { taskNerveProjectsRegistryPath } from "./paths.js";

const FILE_MISSING_MTIME_MS = -1;
const PROJECT_REGISTRY_CACHE_LIMIT = 32;

interface ProjectRegistryCacheEntry {
  mtimeMs: number;
  value: ProjectRegistry;
  raw: string;
}

const projectRegistryCache = new Map<string, ProjectRegistryCacheEntry>();
const projectRegistryInflight = new Map<string, Promise<ProjectRegistry>>();

function getCachedProjectRegistry(filePath: string): ProjectRegistryCacheEntry | null {
  if (!projectRegistryCache.has(filePath)) {
    return null;
  }
  const cached = projectRegistryCache.get(filePath)!;
  projectRegistryCache.delete(filePath);
  projectRegistryCache.set(filePath, cached);
  return cached;
}

function rememberProjectRegistry(filePath: string, entry: ProjectRegistryCacheEntry) {
  if (projectRegistryCache.has(filePath)) {
    projectRegistryCache.delete(filePath);
  }
  projectRegistryCache.set(filePath, entry);
  if (projectRegistryCache.size > PROJECT_REGISTRY_CACHE_LIMIT) {
    const oldestPath = projectRegistryCache.keys().next().value;
    if (typeof oldestPath === "string") {
      projectRegistryCache.delete(oldestPath);
    }
  }
}

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
    const cached = getCachedProjectRegistry(filePath);
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
    const nextRaw = wrote ? formatPrettyJson(normalized) : raw ?? formatPrettyJson(normalized);
    rememberProjectRegistry(filePath, {
      mtimeMs: nextMtimeMs,
      value: normalized,
      raw: nextRaw,
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
  const currentMtimeMs = await fileMtimeMs(filePath);
  const cached = getCachedProjectRegistry(filePath);
  const existingRaw = cached && cached.mtimeMs === currentMtimeMs ? cached.raw : undefined;
  const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw });
  const nextMtimeMs =
    wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
  rememberProjectRegistry(filePath, {
    mtimeMs: nextMtimeMs,
    value: normalized,
    raw: formatPrettyJson(normalized),
  });
  return normalized;
}
