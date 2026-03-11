# Codex TaskNerve Native Cutover Audit

Date: 2026-03-11
Branch: `codex/codex-native`

## Bottom Line

TaskNerve now runs as direct Codex-native integration modules.

Live integration path:
- TypeScript host integration modules under `codex-native/src/integration`
- shared domain logic under `codex-native/src/domain`
- shared persistence under `codex-native/src/io`
- repo-local TaskNerve state plus root project contract markdown files

No runtime patching/injection workflow is part of the supported architecture.

The archived Rust runtime is not part of the live app path.

## Live Runtime

Active runtime surfaces:
- [codex-native/src/integration/taskNerveService.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/taskNerveService.ts)
- [codex-native/src/integration/codexTaskNerveHostRuntime.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/codexTaskNerveHostRuntime.ts)
- [codex-native/src/domain/](/Users/adimus/Documents/taskNerve/codex-native/src/domain)
- [codex-native/src/io/](/Users/adimus/Documents/taskNerve/codex-native/src/io)

Installer behavior:
- [install-macos.sh](/Users/adimus/Documents/taskNerve/install-macos.sh) no longer performs app patching
- [scripts/install-unix.sh](/Users/adimus/Documents/taskNerve/scripts/install-unix.sh) no longer performs app patching

## Archived Runtime

Archived legacy surfaces:
- archived Rust runtime sources
- archived legacy UI sources

These remain for reference and migration history only.

## Product Contract

Supported model on this branch:
- one app: Codex
- one inference path: Codex built-in signed-in inference
- one durable state model: `.tasknerve/`, `project_goals.md`, `project_manifest.md`, `contributing ideas.md`
- one integration direction: direct host integration APIs

Not supported as primary workflows:
- user-facing TaskNerve CLI
- Rust runtime services
- localhost sidecar panel services
- patch/injection-based runtime overlays

## Verification Targets

Healthy state means:
- `codex-native` tests and typecheck pass
- integration behavior is reachable via direct service methods (no bridge dependency)
- no active patch/injection runtime scripts exist in supported paths
- task/project orchestration logic remains fully available from shared integration modules
