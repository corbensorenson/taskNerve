# TaskNerve Agent Guardrails

## Single Source Of Truth
- `codex-native/src` is the only implementation path for TaskNerve runtime behavior.
- `codex-native/test` is validation coverage, not a second runtime branch.

## No Bundle Patching Policy
- Never hand-edit generated bundle artifacts under `target/*` or installed app ASAR extracts.
- Never introduce script-injection or runtime bundle patch workflows in active paths.
- If legacy patching artifacts/scripts are found, move them to `/deprecated` and document the source-first replacement.

## Deploy Policy
- Use deterministic source-first deploy:
  - `bash /Users/adimus/Documents/taskNerve/scripts/deploy-tasknerve-from-source.sh`
- Legacy compatibility wrappers must remain non-primary and clearly marked deprecated.
