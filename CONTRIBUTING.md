# Contributing to TaskNerve

TaskNerve is a Codex-native TypeScript/JavaScript project on this branch.

## Development Setup

1. Use Node.js 20 or newer.
2. Install workspace dependencies:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
```

3. Run checks:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm run typecheck
npm test
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js
```

4. For native app validation on macOS:

```bash
bash /Users/adimus/Documents/taskNerve/install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

## Contribution Rules

- Keep new product logic in TypeScript/JavaScript, not Rust.
- Treat [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/) as archived reference only.
- Keep repo state durable and project-local under `.tasknerve/` plus the root project contract markdown files.
- Preserve Codex-native behavior; do not reintroduce a localhost sidecar or user-facing CLI as a primary path.
- Keep default runtime behavior lightweight; burst behavior should remain explicit and project-scoped.

## Pull Requests

- Use focused PRs.
- Add or adjust tests for behavior changes.
- Update user-facing docs and the bundled skill when workflows change.
- Keep native app install/sync behavior reproducible on macOS.
