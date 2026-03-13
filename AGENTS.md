# TaskNerve Agent Guardrails

## Single Source Of Truth
- `codex-native/src` is the only accepted source-of-truth implementation path for TaskNerve product behavior.
- Generated app extracts, installed app bundles, and any repackaged artifacts are outputs only, never sources.
- Any behavior that still depends on code outside the canonical source path is migration debt and must be moved into maintained source before more product work is layered on top.
- `codex-native/test` is validation coverage, not a second runtime branch.

## No Bundle Patching Policy
- Never hand-edit generated bundle artifacts under `target/*` or installed app ASAR extracts.
- Never introduce script-injection or runtime bundle patch workflows in active paths.
- If legacy patching artifacts/scripts are found, move them to `/deprecated` and document the source-first replacement.
- If a UI/runtime behavior only exists inside generated renderer assets, stop and recover/promote a real source path first instead of patching the bundle.

## Integration Contract
- TaskNerve must integrate directly into Codex host surfaces as if it were built there from the start.
- A localhost bridge is not acceptable product architecture. If one still exists, it is a bug to remove, not a pattern to extend.
- Do not build new features on top of temporary glue, extracted bundles, or migration shims.
- If a path is no longer part of the clean integrated product, move it to `/deprecated` and stop routing active behavior through it.

## Deploy Policy
- Use deterministic source-first deploy:
  - `bash /Users/adimus/Documents/taskNerve/scripts/deploy-tasknerve-from-source.sh`
- Legacy compatibility wrappers must remain non-primary and clearly marked deprecated.
