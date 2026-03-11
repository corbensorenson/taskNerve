# Contributing to TaskNerve

TaskNerve is a Codex-native TypeScript project on this branch.

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
bash /Users/adimus/Documents/taskNerve/scripts/public-release-check.sh
```

## Integration Rules

- Implement product behavior through `codex-native/src/integration`.
- Keep orchestration/business logic in `codex-native/src/domain`.
- Keep persistence in `codex-native/src/io`.
- Do not add app-bundle patching, runtime injection, localhost bridge runtimes, or DOM mutation overlays.
- Keep TaskNerve behavior as Codex-native surfaces and host services.

## Pull Requests

- Keep PRs focused.
- Add or update tests for behavior changes.
- Update docs and skills when workflow or architecture changes.
