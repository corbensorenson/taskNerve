# Project Manifest

Status: draft
Managed by: TaskNerve
Last updated: 2026-03-11

This file locks the technical contract for how `project_goals.md` will be achieved.

## Current Technical Snapshot
- Repository: `taskNerve`
- Repo root: `/Users/adimus/Documents/taskNerve`

### Languages and runtimes
- TypeScript for native domain and integration modules
- Node.js/Electron-compatible runtime boundaries

### Toolchains and package managers
- npm
- TypeScript compiler
- Vitest

### Approved core libraries and tooling
- `zod` for runtime validation
- Vitest for tests
- direct integration modules in `codex-native/src/integration`

### Notable files and directories
- `codex-native/src/integration/`
- `codex-native/src/domain/`
- `codex-native/src/io/`
- `project_goals.md`
- `project_manifest.md`
- `contributing ideas.md`
- `deprecated/rust/` (archived reference only)

## Technical Contract

### Languages and runtimes
- Primary implementation language(s): TypeScript
- Archived-only language(s): Rust under `deprecated/`
- Runtime targets and supported platforms: Codex desktop host integrations

### Libraries and frameworks
- Preferred libraries and frameworks: Node standard library, `zod`, Vitest
- Libraries or patterns to avoid: new live Rust dependencies, sidecar-first architectures, runtime injection layers, app-bundle patch tooling

### Architecture and software patterns
- Module boundaries: domain logic in `codex-native/src/domain`, persistence in `codex-native/src/io`, host integration in `codex-native/src/integration`
- State rules: repo-local `.tasknerve/` plus root project markdown contracts remain the durable source of truth
- Error handling: fail clearly and keep deterministic validation around settings/registry state
- Concurrency model: Codex-hosted services with project-scoped orchestration helpers
- UI patterns: TaskNerve UI should be host-rendered using Codex components/styles, not custom DOM overlays

### Quality gates
- Required commands:
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm install`
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm run typecheck`
  - `cd /Users/adimus/Documents/taskNerve/codex-native && npm test`
  - `bash /Users/adimus/Documents/taskNerve/scripts/public-release-check.sh`
- Required review expectation: maintain Codex-native behavior and keep integration modular
- Required docs updates: README, skill docs, and project contracts whenever workflow changes materially

### Delivery rules
- Migration strategy: all new work targets direct host integration modules
- Performance, security, and cost constraints: prefer Codex-native inference and in-process integration boundaries
- Dependency rule: new dependencies must fit the Codex-native TypeScript direction

## Open Questions For The User
- [ ] Which Codex host integration seam should TaskNerve target first for full UI parity?
- [ ] Which integration API methods are still missing for complete task drawer parity?
- [ ] Which controller defaults should be opinionated versus configurable?

## Lock Status
- [ ] Mark this file as locked once the technical contract is stable.
