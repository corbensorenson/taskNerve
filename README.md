# TaskNerve

TaskNerve is now a direct Codex-native orchestration layer.

## Required macOS Permissions

To use Codex TaskNerve reliably on macOS, users should approve the required system prompts during first launch/setup:

- Keychain access (step 1)
- Keychain access (step 2)
- Documents folder access

![Keychain access step 1](approval%20images/keychain%20access%201.png)
![Keychain access step 2](approval%20images/keychain%20access%202.png)
![Documents access](approval%20images/documents%20access.png)

On branch `codex/codex-native`, the live product path is:
- direct in-process integration modules under `codex-native/src/integration`
- shared domain logic under `codex-native/src/domain`
- shared persistence under `codex-native/src/io`
- repo-local state under `.tasknerve/`
- durable project contracts in:
  - `project_goals.md`
  - `project_manifest.md`
  - `contributing_ideas.md` (legacy repos may still use `contributing ideas.md`)
  - `levers_pitfalls.md`
  - `research.md`
  - `taskNerve/creating_project_skill.md`
  - `taskNerve/using_project_skill.md`
- issue intake safety:
  - GitHub issues should flow into an issue review queue first, not directly to tasks
  - TaskNerve issue filter controls should be used to block malicious/noise inputs before task creation
  - issue-to-task promotion should require explicit approve/reject decisions unless trusted auto-approve is intentionally enabled

No app-bundle patching, script injection, or localhost bridge runtime is supported.

Single development target:
- `codex-native/src` is the only implementation path.
- `codex-native/test` is verification coverage, not a second runtime branch.
- Generated/extracted bundle artifacts are not maintained as source-of-truth code.
- Alpha policy: do not run dual implementation pipelines (no parallel dev/test runtime trees, no duplicate editable bundle copies for the same change).
- If runtime extracts are needed for verification, keep one canonical live tree: `target/codex-tasknerve-app-live-extract` (alias: `target/codex-tasknerve-app-src`).

## Integration Surface

Primary entrypoints:
- [taskNerveService.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/taskNerveService.ts)
- [codexTaskNerveHostRuntime.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/codexTaskNerveHostRuntime.ts)
- [modelTransport.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/modelTransport.ts)

These are designed to be called directly from Codex host code so TaskNerve uses Codex threads, models, settings, and styling surfaces.

Model transport readiness:
- TaskNerve now includes a websocket-ready start-turn transport selector with safe HTTP fallback.
- Runtime env keys: `TASKNERVE_MODEL_TRANSPORT` or `TASKNERVE_MODEL_TRANSPORT_MODE` (`auto`, `http`, `websocket`; default `auto`).
- Runtime API override: `createCodexTaskNerveHostRuntime({ ..., modelTransportMode: "http" | "websocket" | "auto" })`.
- If websocket transport is requested/selected but unavailable or fails, TaskNerve falls back to `startTurn` automatically.

Per-project trace collection:
- Deterministic project traces are written to `taskNerve/project_trace.ndjson` (plus `taskNerve/project_trace_manifest.json`).
- Trace sync is available via `runtime.syncProjectTrace(...)` and is also run automatically during production/automation sync paths.
- Project settings now include trace controls:
  - `trace_collection_enabled`
  - `trace_capture_controller`
  - `trace_capture_agents`
  - `trace_include_message_content`
  - `trace_max_content_chars`

Task template quality:
- Controller prompts now enforce small-task decomposition (prefer `xs`/`s`).
- Task records support richer worker handoff fields:
  - `objective`, `task_type`, `subsystem`
  - `files_in_scope`, `out_of_scope`
  - `acceptance_criteria`, `deliverables`, `verification_steps`
  - `implementation_notes`, `risk_notes`, `estimated_effort`
- Deterministic dispatch quality gate is now available before task dispatch:
  - `task_quality_gate_enabled` (default: `true`)
  - `task_quality_gate_min_score` (default: `80`)
  - `task_quality_gate_include_ci` (default: `false`)
  - Required fields for controller tasks: `title`, `objective`, `acceptance_criteria`,
    `deliverables`, `verification_steps`, `files_in_scope`

## Development

Run checks:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

Run repo checks:

```bash
bash ./scripts/public-release-check.sh
bash ./scripts/vigorous-e2e.sh
```

If local runtime extracts exist under `target/`, collapse duplicate extract trees to one canonical live tree:

```bash
bash ./scripts/enforce-single-runtime-extract.sh
```

Build A/B test integration bundle:

```bash
bash ./install-macos.sh
```

This produces a timestamped artifact under `target/codex-tasknerve-app-build/` containing compiled integration modules, an npm package tarball, bundled skill files, and a build manifest.

## Local App Deploy And Visibility Check

When validating desktop UI/runtime changes locally, deploy from the canonical live extract to avoid stale `app.asar` mismatches:

```bash
bash ./scripts/deploy-live-extract-to-installed-app.sh
```

This script:
- repacks `target/codex-tasknerve-app-live-extract` into installed `app.asar`
- updates `Info.plist` Electron ASAR integrity hash
- re-signs and verifies the app bundle
- writes backups and extracted verification files under `target/install-backups/<timestamp>/`
- builds a timestamped macOS installer DMG at `target/installers/`
- refreshes `target/installers/Codex-TaskNerve-latest.dmg` for easy sharing

Optional env vars:
- `TASKNERVE_SKIP_DMG=1` to skip DMG packaging
- `TASKNERVE_DMG_OUTPUT_DIR=/custom/path` to change installer output directory

Project onboarding UX (desktop live extract):
- In the project drawer header, use `Clone project from GitHub` to paste a clone URL.
- TaskNerve will clone into a deterministic project folder, register/import the project, ensure required TaskNerve docs/artifacts, and bootstrap the controller thread automatically.
- TaskNerve now also ensures a `taskNerve/` contract pack per project:
  - `taskNerve/project_goals.md`
  - `taskNerve/project_manifest.md`
  - `taskNerve/contributing_ideas.md`
  - `taskNerve/levers_pitfalls.md`
  - `taskNerve/research.md`
  - `taskNerve/creating_project_skill.md`
  - `taskNerve/using_project_skill.md`
  - `taskNerve/launch_project.sh`

Install/refresh bundled skill in Codex:

```bash
bash ./scripts/install_codex_skill.sh
```

## Built-In TaskNerve System Skills

Codex TaskNerve ships with a bundled curated skill pack in:
- `target/codex-tasknerve-app-live-extract/skills/skills/.curated`

On app startup, the native bridge now auto-provisions these into the local Codex system skills directory (`$CODEX_HOME/skills/.system`) when missing:
- `tasknerve-import-codex-project`
- `tasknerve-import-general-project`
- `tasknerve-create-project`
- `tasknerve-controller`
- `tasknerve-agents`

Provisioning is idempotent (existing installed skills are left untouched).

## References

- [codex-native/README.md](/Users/adimus/Documents/taskNerve/codex-native/README.md)
- [docs/codex_native_integration_plan.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md)
- [docs/codex_native_integration_surface.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_surface.md)
- [docs/codex_native_cutover_audit.md](/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md)
