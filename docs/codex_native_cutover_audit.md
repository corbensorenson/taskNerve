# Codex TaskNerve Native Cutover Audit

Date: 2026-03-10
Branch: `codex/codex-native`

## Bottom Line

TaskNerve is not fully native to Codex yet.

Today the user-facing product is Codex-native in presentation, but the runtime still depends on the Rust backend for critical behavior:
- task and project state
- task queue mutation APIs
- Codex patch install/sync/uninstall
- panel HTTP service
- controller/worker orchestration state
- local health/doctor/install flows

Because of that, moving `src/main.rs` or the Rust install/runtime code into `/deprecated` right now would break the product instead of simplifying it.

## Native Workspace Status

The native cutover now has a real workspace at `codex-native/`.

Ported there already:
- project Codex settings defaults and model-routing policy
- portable task queue sort/filter/stats helpers
- single-message prompt queue collapse logic
- project goals/manifest template renderers
- controller bootstrap prompt builder
- Codex host-service boundary contract
- repo-local `.tasknerve/codex/project_settings.json` persistence
- global TaskNerve `projects.json` persistence

Not ported yet:
- durable `.tasknerve` reads/writes
- queue mutations and claims
- Codex patch install/sync lifecycle
- live panel data/actions
- controller and worker runtime orchestration

## Current Rust Runtime Dependencies

The current live Codex TaskNerve build still relies on Rust for these surfaces:

### 1. Native panel asset injection

Rust embeds and patches the injected panel assets:
- `src/main.rs`
- `templates/TASKNERVE_CODEX_PANEL.js`
- `templates/TASKNERVE_CODEX_MAIN_BRIDGE.js`

Key functions:
- `render_codex_panel_script`
- `install_codex_integration`
- `sync_codex_integration`

### 2. TaskNerve panel transport

Rust still runs the local panel server and all panel APIs:
- `serve_task_gui`
- `handle_task_gui_connection`
- `/api/tasks`
- `/api/codex/*`
- `/api/project/codex-settings`

The native panel no longer depends on `/api/advisor`, but it still is not a self-contained Codex-side implementation because the rest of the panel transport remains Rust-hosted.

### 3. Durable orchestration engine

Rust still owns:
- project registry
- tasks and claims
- advisor policy/state
- Codex bindings
- queued prompts
- task/timeline persistence under `.tasknerve`

### 4. Desktop patch lifecycle

Rust still owns:
- app bundle patching
- backup/restore of `app.asar`
- LaunchAgent installation
- health/doctor reporting
- sync/reapply after Codex updates

## Native Cutover Criteria

Rust can move into `/deprecated` only after all of the following are true:

1. Codex-side native runtime owns project/task/codex/controller-automation APIs directly.
2. The task queue engine exists in the native runtime, not behind localhost Rust APIs.
3. The patch/sync logic is implemented in the native runtime patch layer or a tiny installer-only tool.
4. The panel no longer depends on `http://127.0.0.1:7788` for normal operation.
5. Controller bootstrap, worker adoption, heartbeat routing, and low-queue automation run without Rust.
6. Repo-local `.tasknerve` state remains readable/writable by the native runtime.

## Recommended Migration Order

### Phase 1: Freeze legacy growth

Do not add new product features that only exist in Rust.

Allowed:
- bug fixes
- compatibility fixes
- parity-preserving support for the current native overlay

### Phase 2: Native host boundary

Create a Codex-native host layer that owns:
- active workspace/project context
- thread discovery and routing
- turn creation and thread creation
- settings UI integration
- git/repo selection reuse from Codex

### Phase 3: Port orchestration core

Port the following domain logic out of Rust:
- project registry and selection
- task CRUD and ordering
- task request/start/claim/advance logic
- worker heartbeat scheduling
- controller low-queue automation
- project codex settings
- project goals/manifest file seeding and lock-state handling

### Phase 4: Replace localhost panel transport

Replace the current Rust HTTP panel service with native in-process state/actions.

### Phase 5: Archive legacy runtime

Only after parity is verified:
- move Rust runtime code into `/deprecated`
- keep installer migration notes
- preserve repo-state compatibility tests

## Immediate Policy

Until the cutover criteria are met:
- Rust is legacy runtime, not deprecated code
- Rust should not be moved into `/deprecated`
- new architecture work should target the native Codex runtime first
- `codex-native/` is the preferred home for any new portable queue, settings, or controller orchestration logic
