# Codex TaskNerve Native Workspace

This directory is the native cutover target for Codex TaskNerve.

Goal:
- move TaskNerve orchestration into TypeScript modules that match Codex's runtime model
- keep repo-local `.tasknerve/`, `project_goals.md`, and `project_manifest.md` as durable project state
- stop growing new product behavior in Rust unless it is parity or compatibility work for the current live app

Current scope:
- portable TaskNerve domain contracts
- zod-backed schemas for repo-local TaskNerve state
- project Codex settings defaults and model-routing policy
- task queue helpers for the native panel/runtime
- controller bootstrap prompt generation
- repo-local settings and project-registry persistence
- host-service boundary for Codex-native integration

Style target:
- TypeScript-first
- Node/Electron-compatible modules
- Vitest test runner
- zod runtime validation
- a future main/preload/renderer split that mirrors the installed Codex desktop app

This workspace does not replace the live Rust runtime yet. The cutover criteria are tracked in:
- `/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md`
- `/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md`

Run checks:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```
