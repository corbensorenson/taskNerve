# Codex TaskNerve Native Cutover Audit

Date: 2026-03-10
Branch: `codex/codex-native`

## Bottom Line

TaskNerve has crossed the cutover.

The live product path is now:
- native JS/TS patch and sync tooling under `codex-native/`
- native in-process TaskNerve services inside the patched Codex desktop runtime
- renderer requests that target the native bridge on `http://127.0.0.1:7791/tasknerve/...`
- repo-local TaskNerve state plus root project contract markdown files

The archived Rust runtime lives under [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/) and is not part of the live app path.

## Live Runtime

Active runtime surfaces:
- [codex-native/](/Users/adimus/Documents/taskNerve/codex-native/)
- [templates/TASKNERVE_CODEX_MAIN_BRIDGE.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js)
- [templates/TASKNERVE_CODEX_PANEL.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js)

Active install and sync path:
- [install-macos.sh](/Users/adimus/Documents/taskNerve/install-macos.sh)
- [scripts/install-unix.sh](/Users/adimus/Documents/taskNerve/scripts/install-unix.sh)
- [codex-native/scripts/sync-codex-tasknerve.mjs](/Users/adimus/Documents/taskNerve/codex-native/scripts/sync-codex-tasknerve.mjs)

## Archived Runtime

Archived legacy surfaces:
- [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/)
- [deprecated/legacy-ui/](/Users/adimus/Documents/taskNerve/deprecated/legacy-ui/)

These remain for reference and migration history only.

## Product Contract

The supported product model on this branch is:
- one app: Codex TaskNerve
- one inference path: Codex's built-in signed-in inference
- one user workflow: native TaskNerve page plus task drawer inside Codex
- one durable project state model: `.tasknerve/`, `project_goals.md`, `project_manifest.md`, `contributing ideas.md`

Not supported as primary workflows anymore:
- user-facing TaskNerve CLI
- Rust runtime services
- the old browser task GUI
- the old localhost `7788` panel sidecar

## Verification Targets

Healthy native state means:
- `127.0.0.1:7788` is not serving the old panel runtime
- `127.0.0.1:7791/tasknerve/health` reports healthy
- the patched app bundle contains the injected native bridge and panel assets
- TaskNerve task/project actions work from inside Codex without a separate CLI process
