import path from "node:path";

import {
  PROJECT_GOALS_FILE,
  PROJECT_MANIFEST_FILE,
  TASKNERVE_PROJECT_DIR,
  TIMELINE_ROOT_DIR,
} from "../constants.js";

export function resolveTaskNerveHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TASKNERVE_HOME?.trim();
  if (explicit) {
    return explicit;
  }
  const home = env.HOME?.trim();
  if (home) {
    return path.join(home, ".tasknerve");
  }
  const profile = env.USERPROFILE?.trim();
  if (profile) {
    return path.join(profile, ".tasknerve");
  }
  throw new Error("unable to resolve TASKNERVE_HOME; set TASKNERVE_HOME, HOME, or USERPROFILE");
}

export function timelineRoot(repoRoot: string): string {
  return path.join(repoRoot, TIMELINE_ROOT_DIR);
}

export function timelineProjectCodexSettingsPath(repoRoot: string): string {
  return path.join(timelineRoot(repoRoot), "codex", "project_settings.json");
}

export function taskNerveProjectsRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskNerveHome(env), "projects.json");
}

export function projectGoalsPath(repoRoot: string): string {
  return path.join(repoRoot, PROJECT_GOALS_FILE);
}

export function projectManifestPath(repoRoot: string): string {
  return path.join(repoRoot, PROJECT_MANIFEST_FILE);
}

export function taskNerveProjectDir(repoRoot: string): string {
  return path.join(repoRoot, TASKNERVE_PROJECT_DIR);
}

export function projectTracePath(repoRoot: string): string {
  return path.join(taskNerveProjectDir(repoRoot), "project_trace.ndjson");
}

export function projectTraceManifestPath(repoRoot: string): string {
  return path.join(taskNerveProjectDir(repoRoot), "project_trace_manifest.json");
}

export function timelineProjectTraceStatePath(repoRoot: string): string {
  return path.join(timelineRoot(repoRoot), "codex", "project_trace_state.json");
}

export function timelineProjectAgentWatchdogStatePath(repoRoot: string): string {
  return path.join(timelineRoot(repoRoot), "codex", "project_agent_watchdog_state.json");
}
