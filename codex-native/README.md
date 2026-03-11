# Codex TaskNerve Native Workspace

This is the active TaskNerve runtime workspace.

The product model on `codex/codex-native` is:
- Codex desktop app as the host shell
- TaskNerve native services injected into the host runtime
- repo-local TaskNerve state
- no supported user-facing TaskNerve CLI
- no Rust in the live runtime path

## What Lives Here

- TypeScript domain contracts for project/task/settings logic
- repo-local persistence helpers
- Codex host-service boundaries
- native patch/sync tooling for `Codex TaskNerve.app`

## Runtime Shape

TaskNerve should follow Codex's own implementation model as closely as possible:
- TypeScript-first
- Electron-compatible boundaries
- `zod` for runtime validation
- Vitest for tests
- in-app native services instead of a second process or user CLI

## Checks

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

## Local Sync

```bash
bash /Users/adimus/Documents/taskNerve/install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

## References

- [README.md](/Users/adimus/Documents/taskNerve/README.md)
- [docs/codex_native_cutover_audit.md](/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md)
- [docs/codex_native_style_contract.md](/Users/adimus/Documents/taskNerve/docs/codex_native_style_contract.md)
