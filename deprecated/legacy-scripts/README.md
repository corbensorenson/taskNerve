# Deprecated Legacy Scripts

These scripts are archived for historical reference only.

They are **not** the supported path for ongoing TaskNerve development or release.

## Policy

- Source-of-truth implementation is `codex-native/src`.
- Generated runtime artifacts under `target/*` are deployment/build outputs only.
- Do **not** hand-edit generated bundle artifacts (for example `index-*.js` under `target/codex-tasknerve-app-live-extract/webview/assets/`).

## Current deterministic path

Use:

```bash
bash /Users/adimus/Documents/taskNerve/scripts/deploy-tasknerve-from-source.sh
```

Do not create new workflows that directly patch minified bundle assets.
