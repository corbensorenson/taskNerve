import { stat } from "node:fs/promises";

import { SCHEMA_PROJECT_AGENT_WATCHDOG_STATE, nowIsoUtc } from "../constants.js";
import {
  projectAgentWatchdogStateSchema,
  type ProjectAgentWatchdogState,
} from "../schemas.js";
import {
  formatPrettyJson,
  readJsonOptionalWithRaw,
  writePrettyJsonIfChanged,
} from "./jsonStore.js";
import { timelineProjectAgentWatchdogStatePath } from "./paths.js";

const FILE_MISSING_MTIME_MS = -1;
const PROJECT_AGENT_WATCHDOG_STATE_CACHE_LIMIT = 256;

interface ProjectAgentWatchdogStateCacheEntry {
  mtimeMs: number;
  value: ProjectAgentWatchdogState;
  raw: string;
}

const projectAgentWatchdogStateCache = new Map<string, ProjectAgentWatchdogStateCacheEntry>();
const projectAgentWatchdogStateInflight = new Map<string, Promise<ProjectAgentWatchdogState>>();

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeUtcRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeOptionalText(rawKey);
    const parsedValue = normalizeOptionalText(rawValue);
    if (!key || !parsedValue) {
      continue;
    }
    normalized[key] = parsedValue;
  }
  return normalized;
}

function normalizeProjectAgentWatchdogState(
  value: Partial<ProjectAgentWatchdogState> | null | undefined,
): ProjectAgentWatchdogState {
  return projectAgentWatchdogStateSchema.parse({
    schema_version: SCHEMA_PROJECT_AGENT_WATCHDOG_STATE,
    updated_at_utc: normalizeOptionalText(value?.updated_at_utc) ?? nowIsoUtc(),
    controller_last_reset_at_utc: normalizeOptionalText(value?.controller_last_reset_at_utc),
    last_recovery_by_task: normalizeUtcRecord(value?.last_recovery_by_task),
    last_recovery_by_thread: normalizeUtcRecord(value?.last_recovery_by_thread),
  });
}

function getCachedProjectAgentWatchdogState(
  filePath: string,
): ProjectAgentWatchdogStateCacheEntry | null {
  if (!projectAgentWatchdogStateCache.has(filePath)) {
    return null;
  }
  const cached = projectAgentWatchdogStateCache.get(filePath)!;
  projectAgentWatchdogStateCache.delete(filePath);
  projectAgentWatchdogStateCache.set(filePath, cached);
  return cached;
}

function rememberProjectAgentWatchdogState(
  filePath: string,
  entry: ProjectAgentWatchdogStateCacheEntry,
) {
  if (projectAgentWatchdogStateCache.has(filePath)) {
    projectAgentWatchdogStateCache.delete(filePath);
  }
  projectAgentWatchdogStateCache.set(filePath, entry);
  if (projectAgentWatchdogStateCache.size > PROJECT_AGENT_WATCHDOG_STATE_CACHE_LIMIT) {
    const oldestPath = projectAgentWatchdogStateCache.keys().next().value;
    if (typeof oldestPath === "string") {
      projectAgentWatchdogStateCache.delete(oldestPath);
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

export async function loadProjectAgentWatchdogState(
  repoRoot: string,
): Promise<ProjectAgentWatchdogState> {
  const filePath = timelineProjectAgentWatchdogStatePath(repoRoot);
  const inflight = projectAgentWatchdogStateInflight.get(filePath);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = getCachedProjectAgentWatchdogState(filePath);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      return cached.value;
    }

    const { value: current, raw } = await readJsonOptionalWithRaw(filePath, projectAgentWatchdogStateSchema);
    const normalized = normalizeProjectAgentWatchdogState(current || {});
    const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw: raw });
    const nextMtimeMs =
      wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
    const nextRaw = wrote ? formatPrettyJson(normalized) : raw ?? formatPrettyJson(normalized);
    rememberProjectAgentWatchdogState(filePath, {
      mtimeMs: nextMtimeMs,
      value: normalized,
      raw: nextRaw,
    });
    return normalized;
  })();

  projectAgentWatchdogStateInflight.set(filePath, promise);
  return promise.finally(() => {
    projectAgentWatchdogStateInflight.delete(filePath);
  });
}

export async function writeProjectAgentWatchdogState(
  repoRoot: string,
  state: Partial<ProjectAgentWatchdogState>,
): Promise<ProjectAgentWatchdogState> {
  const filePath = timelineProjectAgentWatchdogStatePath(repoRoot);
  const normalized = normalizeProjectAgentWatchdogState(state);
  const currentMtimeMs = await fileMtimeMs(filePath);
  const cached = getCachedProjectAgentWatchdogState(filePath);
  const existingRaw = cached && cached.mtimeMs === currentMtimeMs ? cached.raw : undefined;
  const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw });
  const nextMtimeMs =
    wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
  const nextRaw = formatPrettyJson(normalized);
  rememberProjectAgentWatchdogState(filePath, {
    mtimeMs: nextMtimeMs,
    value: normalized,
    raw: nextRaw,
  });
  return normalized;
}
