export const SCHEMA_PROJECT_CODEX_SETTINGS = "tasknerve.project_codex_settings.v1";
export const SCHEMA_PROJECTS = "tasknerve.projects.v1";
export const PROJECT_GOALS_FILE = "project_goals.md";
export const PROJECT_MANIFEST_FILE = "project_manifest.md";
export const TIMELINE_ROOT_DIR = ".tasknerve";
export const CONTROLLER_AGENT_ID = "agent.controller";
export const DEFAULT_HEARTBEAT_MESSAGE_CORE = "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!";
export const DEFAULT_LOW_QUEUE_CONTROLLER_PROMPT = "The TaskNerve queue for {project_name} is running low. Review the current repository state, `project_goals.md`, `project_manifest.md`, and the existing TaskNerve backlog. Add the next best development and maintenance tasks, consolidate stale work, and keep the active workers fed with concrete, high-leverage tasks.";
export const INTELLIGENCE_LEVELS = ["low", "medium", "high", "max"];
export function nowIsoUtc() {
    return new Date().toISOString();
}
//# sourceMappingURL=constants.js.map