# TaskNerve

TaskNerve is intended to be a clean Codex 2.0 style integration: one maintained source path, one deterministic deploy path, no patchwork.

## Required macOS Permissions

To use Codex TaskNerve reliably on macOS, users should approve the required system prompts during first launch/setup:

- Keychain access (step 1)
- Keychain access (step 2)
- Documents folder access

![Keychain access step 1](approval%20images/keychain%20access%201.png)
![Keychain access step 2](approval%20images/keychain%20access%202.png)
![Documents access](approval%20images/documents%20access.png)

The intended live product path is:
- direct in-process TaskNerve runtime modules under `codex-native/src/integration`
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

Required architecture:
- no app-bundle patching
- no script injection
- no localhost bridge as part of the product architecture
- no duplicate runtime paths
- no behavior implemented only inside generated artifacts
- if code is no longer part of the clean integrated product, move it to `/deprecated`

Single development target:
- `codex-native/src` is the only accepted source-of-truth implementation path for product behavior.
- `codex-native/test` is verification coverage, not a second runtime branch.
- Generated/extracted bundle artifacts are not maintained as source-of-truth code.
- Never hand-edit generated bundle artifacts in `target/*` (for example `target/codex-tasknerve-app-live-extract/webview/assets/index-*.js`).
- Alpha policy: do not run dual implementation pipelines (no parallel dev/test runtime trees, no duplicate editable bundle copies for the same change).
- If runtime artifacts are needed for verification, keep one canonical generated tree: `target/codex-tasknerve-app-live-extract` (alias: `target/codex-tasknerve-app-src`).
- If a UI behavior only exists inside generated renderer output, stop and recover a maintained source path before changing product behavior.
- If a live behavior still depends on anything outside the canonical source path, treat that as migration debt to eliminate before layering on more features.

## Integration Surface

Primary entrypoints:
- [taskNerveService.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/taskNerveService.ts)
- [codexTaskNerveHostRuntime.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/codexTaskNerveHostRuntime.ts)
- [modelTransport.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/modelTransport.ts)

These are designed to be called directly from Codex host code so TaskNerve uses Codex threads, models, settings, and styling surfaces.
Any deviation from that rule is a cleanup task, not a permanent architecture choice.

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
pnpm install
pnpm run tsc
pnpm run test:quiet
```

Run repo checks:

```bash
bash ./scripts/public-release-check.sh
bash ./scripts/vigorous-e2e.sh
```

If you need CI to fail whenever full native compile/tests are unavailable in the current checkout, run:

```bash
TASKNERVE_REQUIRE_FULL_NATIVE_CHECKS=1 bash ./scripts/public-release-check.sh
```

Prune heavyweight local build/install artifacts in `target/` (deterministic retention):

```bash
bash ./scripts/clean-target-retention.sh
```

To aggressively reclaim local disk from transient build outputs:

```bash
bash ./scripts/clean-target-retention.sh --drop-debug-release
```

If local runtime artifacts exist under `target/`, collapse duplicate trees to one canonical generated tree:

```bash
bash ./scripts/enforce-single-runtime-extract.sh
```

Single deterministic local deploy (source -> installed app -> latest DMG):

```bash
bash ./install-macos.sh
```

Equivalent direct entrypoint:

```bash
bash ./scripts/deploy-tasknerve-from-source.sh
```

This flow:
- enforces one canonical generated runtime artifact path (`target/codex-tasknerve-app-live-extract`)
- runs native source checks/build from `codex-native/src`
- packs/signs the installed app from canonical generated artifact
- builds/refreshes the latest DMG installer

## Local App Deploy And Visibility Check

Low-level deploy helper (used by the deterministic entrypoint above):

```bash
bash ./scripts/deploy-installed-app-from-canonical-build.sh
```

This helper script:
- packs canonical generated runtime artifact into installed `app.asar`
- updates `Info.plist` Electron ASAR integrity hash
- re-signs and verifies the app bundle
- writes backups and extracted verification files under `target/install-backups/<timestamp>/`
- builds a timestamped macOS installer DMG at `target/installers/`
- refreshes `target/installers/Codex-TaskNerve-latest.dmg` for easy sharing

Deprecated direct entrypoint:
- `scripts/deploy-live-extract-to-installed-app.sh` is now a compatibility wrapper and should not be used for new workflows.
- Historical legacy behavior/scripts are archived under `deprecated/legacy-scripts/`.

Optional env vars:
- `TASKNERVE_SKIP_DMG=1` to skip DMG packaging
- `TASKNERVE_DMG_OUTPUT_DIR=/custom/path` to change installer output directory
- `TASKNERVE_SPARKLE_FEED_URL=https://.../appcast.xml` to override update feed during deploy

## Update Interceptor (Two-Phase)

TaskNerve now includes an upstream update interceptor so users are protected from direct upstream Codex updates that may break TaskNerve customization.

Contract:
- Phase 1 (critical-fast): compatibility-critical areas are auto-processed first.
- Phase 2 (owner approval): non-critical follow-up changes are sent to GitHub Issues for owner review/approval.

Policy/state files:
- `taskNerve/update/update_interceptor_policy.json`
- `taskNerve/update/upstream_codex_state.json`
- `taskNerve/update/update_channel_manifest.json`
- `taskNerve/update/critical_update_queue.json`
- `taskNerve/update/review_update_queue.json`

Run one interceptor cycle manually:

```bash
python3 ./scripts/codex-update-interceptor.py --repo-root /Users/adimus/Documents/taskNerve
```

GitHub issue routing auth:
- Preferred: export `GITHUB_TOKEN` (or `GH_TOKEN` / `TASKNERVE_UPDATE_GITHUB_TOKEN`) with repo `issues:write`.
- Fallback: `gh auth login` (CLI mode) if token env vars are not set.

Install background daemon on macOS (launchd, runs every 15 minutes by default):

```bash
bash ./scripts/install-tasknerve-update-daemon.sh
```

Check daemon status:

```bash
bash ./scripts/tasknerve-update-daemon-status.sh
```

Uninstall daemon:

```bash
bash ./scripts/uninstall-tasknerve-update-daemon.sh
```

Phase-2 approval helper (marks queue item owner-approved; optional issue close):

```bash
python3 ./scripts/tasknerve-approve-phase2-update.py --repo-root /Users/adimus/Documents/taskNerve --fingerprint <fingerprint> --close-issue
```

Project onboarding UX (desktop native app):
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
