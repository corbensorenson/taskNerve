# Codex TaskNerve Native Workspace

This is the active TaskNerve integration workspace.

## Runtime Model

TaskNerve is integrated directly into Codex host runtime surfaces via:
- `src/integration/taskNerveService.ts`
- `src/integration/codexTaskNerveHostRuntime.ts`
- `src/integration/codexConversationDisplay.ts`
- `src/integration/codexConversationInteraction.ts`
- `src/integration/codexConversationChrome.ts`

No app-bundle patching or runtime script injection is part of the supported architecture.

## Workspace Layout

- `src/domain`: orchestration/domain logic
- `src/io`: repo-local persistence helpers
- `src/host`: Codex host-service contracts
- `src/integration`: Codex-facing integration runtime modules

## Checks

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

## References

- [README.md](/Users/adimus/Documents/taskNerve/README.md)
- [docs/codex_native_integration_plan.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md)
- [docs/codex_native_integration_surface.md](/Users/adimus/Documents/taskNerve/docs/codex_native_integration_surface.md)
