import path from "node:path";
import { PROJECT_GOALS_FILE, PROJECT_MANIFEST_FILE, TIMELINE_ROOT_DIR, } from "../constants.js";
export function resolveTaskNerveHome(env = process.env) {
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
export function timelineRoot(repoRoot) {
    return path.join(repoRoot, TIMELINE_ROOT_DIR);
}
export function timelineProjectCodexSettingsPath(repoRoot) {
    return path.join(timelineRoot(repoRoot), "codex", "project_settings.json");
}
export function taskNerveProjectsRegistryPath(env = process.env) {
    return path.join(resolveTaskNerveHome(env), "projects.json");
}
export function projectGoalsPath(repoRoot) {
    return path.join(repoRoot, PROJECT_GOALS_FILE);
}
export function projectManifestPath(repoRoot) {
    return path.join(repoRoot, PROJECT_MANIFEST_FILE);
}
//# sourceMappingURL=paths.js.map