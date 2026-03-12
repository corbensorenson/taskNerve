# TaskNerve

TaskNerve is now a direct Codex-native orchestration layer.

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

These are designed to be called directly from Codex host code so TaskNerve uses Codex threads, models, settings, and styling surfaces.

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
