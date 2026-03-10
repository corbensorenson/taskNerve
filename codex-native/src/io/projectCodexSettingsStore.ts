import { normalizeProjectCodexSettings } from "../domain/projectCodexSettings.js";
import { projectCodexSettingsSchema, type ProjectCodexSettings } from "../schemas.js";
import { readJsonOptional, writePrettyJson } from "./jsonStore.js";
import { timelineProjectCodexSettingsPath } from "./paths.js";

export async function loadProjectCodexSettings(options: {
  repoRoot: string;
  gitOriginUrl?: string | null;
}): Promise<ProjectCodexSettings> {
  const filePath = timelineProjectCodexSettingsPath(options.repoRoot);
  const current = await readJsonOptional(filePath, projectCodexSettingsSchema);
  const normalized = normalizeProjectCodexSettings(current || {}, {
    gitOriginUrl: options.gitOriginUrl,
  });
  await writePrettyJson(filePath, normalized);
  return normalized;
}

export async function writeProjectCodexSettings(
  repoRoot: string,
  settings: Partial<ProjectCodexSettings>,
): Promise<ProjectCodexSettings> {
  const normalized = normalizeProjectCodexSettings(settings);
  await writePrettyJson(timelineProjectCodexSettingsPath(repoRoot), normalized);
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
