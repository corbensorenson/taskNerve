# Project Manifest

Status: draft
Managed by: TaskNerve
Last updated: 2026-03-10

This file locks the technical contract for how `project_goals.md` will be achieved.

## Current Technical Snapshot
- Repository: `taskNerve`
- Repo root: `/Users/adimus/Documents/taskNerve`

### Languages and runtimes
- TypeScript for portable native domain logic
- JavaScript for injected main-process and renderer bridge assets
- Node.js and Electron-compatible runtime boundaries

### Toolchains and package managers
- npm
- TypeScript compiler
- Vitest

### Approved core libraries and tooling
- `zod` for runtime validation
- Vitest for tests
- native Codex desktop bundle patching through `codex-native/scripts/sync-codex-tasknerve.mjs`

### Notable files and directories
- `codex-native/`
- `templates/TASKNERVE_CODEX_MAIN_BRIDGE.js`
- `templates/TASKNERVE_CODEX_PANEL.js`
- `project_goals.md`
- `project_manifest.md`
- `contributing ideas.md`
- `deprecated/rust/` for archived reference only

## Technical Contract

### Languages and runtimes
- Primary implementation language(s): TypeScript and JavaScript
- Archived-only language(s): Rust under `deprecated/`
- Runtime targets and supported platforms: Electron/Codex desktop, macOS first

### Libraries and frameworks
- Preferred libraries and frameworks: Node standard library, `zod`, Vitest
- Libraries or patterns to avoid: new live Rust dependencies, sidecar-first architectures, redundant local HTTP services as the primary product path

### Architecture and software patterns
- Module boundaries: portable domain logic in `codex-native/src`, live host patch assets in `templates/`
- State rules: repo-local `.tasknerve/` plus root project markdown contracts remain the durable source of truth
- Error handling: fail clearly, prefer deterministic health probes, keep patching reversible
- Concurrency model: Codex-hosted native services with project-scoped orchestration and lightweight background refresh
- UI patterns: match Codex styling and chrome; keep TaskNerve settings compact and task work drawer-first

### Quality gates
- Required commands:
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm install`
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm run typecheck`
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm test`
  - `node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js`
  - `node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js`
- Required review expectation: native UX changes should be reviewed against how Codex itself behaves
- Required docs updates: README, skill docs, and project contracts whenever workflow changes materially

### Delivery rules
- Migration strategy: keep archived Rust reference-only; do not reintroduce it to the live path
- Performance, security, and cost constraints: prefer Codex-native inference and efficient multi-agent orchestration
- Dependency rule: new dependencies must fit the Codex-native TypeScript direction

## Open Questions For The User
- [ ] Which Codex UI surfaces should TaskNerve integrate with next?
- [ ] Which project settings belong in the compact settings drawer versus a fuller project page?
- [ ] Which native host hooks should be treated as stable versus patch-layer implementation details?

## Lock Status
- [ ] Mark this file as locked once the technical contract is stable.
