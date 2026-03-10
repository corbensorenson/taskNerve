import { SCHEMA_PROJECTS, nowIsoUtc } from "../constants.js";
import { projectRegistrySchema, type ProjectRegistry } from "../schemas.js";
import { readJsonOptional, writePrettyJson } from "./jsonStore.js";
import { taskNerveProjectsRegistryPath } from "./paths.js";

export async function loadProjectRegistry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRegistry> {
  const filePath = taskNerveProjectsRegistryPath(env);
  const current = await readJsonOptional(filePath, projectRegistrySchema);
  const normalized = projectRegistrySchema.parse(
    current || {
      schema_version: SCHEMA_PROJECTS,
      updated_at_utc: nowIsoUtc(),
      default_project: null,
      projects: [],
    },
  );
  normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
  await writePrettyJson(filePath, normalized);
  return normalized;
}

export async function writeProjectRegistry(
  registry: ProjectRegistry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRegistry> {
  const normalized = projectRegistrySchema.parse(registry);
  normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
  await writePrettyJson(taskNerveProjectsRegistryPath(env), normalized);
  return normalized;
}
