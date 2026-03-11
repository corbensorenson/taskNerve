# TaskNerve

TaskNerve is now a Codex-native project orchestration layer.

On branch `codex/codex-native`, the live product is:
- a patched `Codex TaskNerve.app`
- native in-process TaskNerve services exposed from the Codex desktop runtime
- repo-local state under `.tasknerve/`
- durable project contracts in `project_goals.md`, `project_manifest.md`, and `contributing ideas.md`

There is no supported user-facing TaskNerve CLI on this branch anymore. The archived Rust runtime lives under [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/) for reference only.

## Current Architecture

TaskNerve now runs inside Codex instead of beside it.

Codex owns:
- signed-in inference
- threads and thread UX
- workspace selection
- window management
- the main desktop shell

TaskNerve owns:
- project registry and project-scoped settings
- task queue state and task drawer UX
- controller and worker orchestration policy
- project document management
- project traces and timeline-aligned exports
- TaskNerve branch state layered on top of the project workflow

## Install And Sync

macOS is the active native target.

Install or resync the local app:

```bash
bash ./install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

Install or refresh the bundled skill in Codex:

```bash
bash ./scripts/install_codex_skill.sh
```

## Daily Use

Use TaskNerve from inside `Codex TaskNerve.app`:
- open the TaskNerve page from the left navigation when you want project settings
- use the task-count chip in the Codex chrome to open the task drawer
- manage tasks from the drawer with search, add, and edit popups
- manage per-project settings, controller bootstrap, heartbeat policy, traces, and worker limits from the TaskNerve page
- review and edit `project_goals.md`, `project_manifest.md`, and `contributing ideas.md` directly inside Codex

## Development

Native runtime work belongs in:
- [codex-native/](/Users/adimus/Documents/taskNerve/codex-native/)
- [templates/TASKNERVE_CODEX_MAIN_BRIDGE.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js)
- [templates/TASKNERVE_CODEX_PANEL.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js)

Run native checks:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

Useful repo checks:

```bash
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js
bash ./scripts/public-release-check.sh
```

Resync the local patched app after native changes:

```bash
bash ./install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

## Deprecated

Archived legacy surfaces:
- [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/)
- [deprecated/legacy-ui/](/Users/adimus/Documents/taskNerve/deprecated/legacy-ui/)

Cutover details:
- [docs/codex_native_cutover_audit.md](/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md)
- [docs/codex_native_integration_plan.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md)
