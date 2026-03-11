# TaskNerve

TaskNerve is now a direct Codex-native orchestration layer.

On branch `codex/codex-native`, the live product path is:
- direct in-process integration modules under `codex-native/src/integration`
- shared domain logic under `codex-native/src/domain`
- shared persistence under `codex-native/src/io`
- repo-local state under `.tasknerve/`
- durable project contracts in `project_goals.md`, `project_manifest.md`, and `contributing ideas.md`

No app-bundle patching, script injection, or localhost bridge runtime is supported.

Single development target:
- `codex-native/src` is the only implementation path.
- `codex-native/test` is verification coverage, not a second runtime branch.
- Generated/extracted bundle artifacts are not maintained as source-of-truth code.

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

Install/refresh bundled skill in Codex:

```bash
bash ./scripts/install_codex_skill.sh
```

## References

- [codex-native/README.md](/Users/adimus/Documents/taskNerve/codex-native/README.md)
- [docs/codex_native_integration_plan.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md)
- [docs/codex_native_integration_surface.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_surface.md)
- [docs/codex_native_cutover_audit.md](/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md)
