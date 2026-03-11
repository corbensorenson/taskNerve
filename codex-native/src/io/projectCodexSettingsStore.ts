import { stat } from "node:fs/promises";

import { normalizeProjectCodexSettings } from "../domain/projectCodexSettings.js";
import { projectCodexSettingsSchema, type ProjectCodexSettings } from "../schemas.js";
import {
  formatPrettyJson,
  readJsonOptionalWithRaw,
  writePrettyJsonIfChanged,
} from "./jsonStore.js";
import { timelineProjectCodexSettingsPath } from "./paths.js";

const FILE_MISSING_MTIME_MS = -1;

interface ProjectCodexSettingsCacheEntry {
  mtimeMs: number;
  value: ProjectCodexSettings;
  raw: string;
}

const projectCodexSettingsCache = new Map<string, ProjectCodexSettingsCacheEntry>();
const projectCodexSettingsInflight = new Map<string, Promise<ProjectCodexSettings>>();

function normalizeGitOriginUrl(gitOriginUrl: string | null | undefined): string | null {
  const text = typeof gitOriginUrl === "string" ? gitOriginUrl.trim() : "";
  return text || null;
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
  const inflight = projectCodexSettingsInflight.get(filePath);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = projectCodexSettingsCache.get(filePath);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      const cachedGitOriginUrl = normalizeGitOriginUrl(cached.value.git_origin_url);
      if (!normalizedGitOriginUrl || cachedGitOriginUrl) {
        return cached.value;
      }

      const upgraded = normalizeProjectCodexSettings(cached.value, {
        gitOriginUrl: normalizedGitOriginUrl,
      });
      const wrote = await writePrettyJsonIfChanged(filePath, upgraded, {
        existingRaw: cached.raw,
      });
      if (!wrote) {
        return cached.value;
      }
      const nextMtimeMs = await fileMtimeMs(filePath);
      const nextRaw = formatPrettyJson(upgraded);
      projectCodexSettingsCache.set(filePath, {
        mtimeMs: nextMtimeMs,
        value: upgraded,
        raw: nextRaw,
      });
      return upgraded;
    }

    const { value: current, raw } = await readJsonOptionalWithRaw(filePath, projectCodexSettingsSchema);
    const normalized = normalizeProjectCodexSettings(current || {}, {
      gitOriginUrl: normalizedGitOriginUrl,
    });
    const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw: raw });
    const nextMtimeMs =
      wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
    const nextRaw = wrote ? formatPrettyJson(normalized) : raw ?? formatPrettyJson(normalized);
    projectCodexSettingsCache.set(filePath, {
      mtimeMs: nextMtimeMs,
      value: normalized,
      raw: nextRaw,
    });
    return normalized;
  })();

  projectCodexSettingsInflight.set(filePath, promise);
  return promise.finally(() => {
    projectCodexSettingsInflight.delete(filePath);
  });
}

export async function writeProjectCodexSettings(
  repoRoot: string,
  settings: Partial<ProjectCodexSettings>,
): Promise<ProjectCodexSettings> {
  const filePath = timelineProjectCodexSettingsPath(repoRoot);
  const normalized = normalizeProjectCodexSettings(settings);
  const currentMtimeMs = await fileMtimeMs(filePath);
  const cached = projectCodexSettingsCache.get(filePath);
  const existingRaw = cached && cached.mtimeMs === currentMtimeMs ? cached.raw : undefined;
  const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw });
  const nextMtimeMs =
    wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
  const nextRaw = formatPrettyJson(normalized);
  projectCodexSettingsCache.set(filePath, {
    mtimeMs: nextMtimeMs,
    value: normalized,
    raw: nextRaw,
  });
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
