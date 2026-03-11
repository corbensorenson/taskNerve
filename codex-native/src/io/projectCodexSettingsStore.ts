import { stat } from "node:fs/promises";

import { normalizeProjectCodexSettings } from "../domain/projectCodexSettings.js";
import { projectCodexSettingsSchema, type ProjectCodexSettings } from "../schemas.js";
import { readJsonOptionalWithRaw, writePrettyJsonIfChanged } from "./jsonStore.js";
import { timelineProjectCodexSettingsPath } from "./paths.js";

const FILE_MISSING_MTIME_MS = -1;
const CACHE_KEY_SEPARATOR = "::";

interface ProjectCodexSettingsCacheEntry {
  mtimeMs: number;
  value: ProjectCodexSettings;
}

const projectCodexSettingsCache = new Map<string, ProjectCodexSettingsCacheEntry>();
const projectCodexSettingsInflight = new Map<string, Promise<ProjectCodexSettings>>();

function normalizeGitOriginUrl(gitOriginUrl: string | null | undefined): string | null {
  const text = typeof gitOriginUrl === "string" ? gitOriginUrl.trim() : "";
  return text || null;
}

function settingsCacheKey(filePath: string, gitOriginUrl: string | null): string {
  return `${filePath}${CACHE_KEY_SEPARATOR}${gitOriginUrl || ""}`;
}

function clearProjectCodexSettingsCacheForPath(filePath: string) {
  const prefix = `${filePath}${CACHE_KEY_SEPARATOR}`;
  for (const key of projectCodexSettingsCache.keys()) {
    if (key.startsWith(prefix)) {
      projectCodexSettingsCache.delete(key);
    }
  }
  for (const key of projectCodexSettingsInflight.keys()) {
    if (key.startsWith(prefix)) {
      projectCodexSettingsInflight.delete(key);
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

export async function loadProjectCodexSettings(options: {
  repoRoot: string;
  gitOriginUrl?: string | null;
}): Promise<ProjectCodexSettings> {
  const filePath = timelineProjectCodexSettingsPath(options.repoRoot);
  const normalizedGitOriginUrl = normalizeGitOriginUrl(options.gitOriginUrl);
  const cacheKey = settingsCacheKey(filePath, normalizedGitOriginUrl);
  const inflight = projectCodexSettingsInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = projectCodexSettingsCache.get(cacheKey);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      return cached.value;
    }

    const { value: current, raw } = await readJsonOptionalWithRaw(filePath, projectCodexSettingsSchema);
    const normalized = normalizeProjectCodexSettings(current || {}, {
      gitOriginUrl: normalizedGitOriginUrl,
    });
    const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw: raw });
    const nextMtimeMs =
      wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
    clearProjectCodexSettingsCacheForPath(filePath);
    projectCodexSettingsCache.set(cacheKey, {
      mtimeMs: nextMtimeMs,
      value: normalized,
    });
    return normalized;
  })();

  projectCodexSettingsInflight.set(cacheKey, promise);
  return promise.finally(() => {
    projectCodexSettingsInflight.delete(cacheKey);
  });
}

export async function writeProjectCodexSettings(
  repoRoot: string,
  settings: Partial<ProjectCodexSettings>,
): Promise<ProjectCodexSettings> {
  const filePath = timelineProjectCodexSettingsPath(repoRoot);
  const normalized = normalizeProjectCodexSettings(settings);
  await writePrettyJsonIfChanged(filePath, normalized);
  const nextMtimeMs = await fileMtimeMs(filePath);
  clearProjectCodexSettingsCacheForPath(filePath);
  projectCodexSettingsCache.set(
    settingsCacheKey(filePath, normalizeGitOriginUrl(normalized.git_origin_url)),
    {
      mtimeMs: nextMtimeMs,
      value: normalized,
    },
  );
  return normalized;
}

export async function projectCodexSettingsPayload(options: {
  repoRoot: string;
  gitOriginUrl?: string | null;
}) {
  const settings = await loadProjectCodexSettings(options);
  return {
    ...settings,
    actual_git_origin_url: options.gitOriginUrl ?? null,
  };
}
