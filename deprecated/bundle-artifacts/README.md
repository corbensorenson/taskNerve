# Deprecated Bundle Artifacts

This folder stores extracted/minified web bundle files that are no longer
maintained as live TaskNerve source code.

Current archived artifacts:
- `index-CMu6BCpo.js`
- `skills-page-DeBxXSaK.js`
- `codex-native-extract/main.js`
- `codex-native-extract/index.html`
- `codex-native-dist-snapshot/dist/*`

Reason:
- Root-level hashed bundle outputs add noise and are not part of the direct
  TypeScript integration path under `codex-native/src`.
- `scripts/public-release-check.sh` already enforces that
  `index-CMu6BCpo.js` must not exist at repository root.
- `codex-native/main.js` and `codex-native/index.html` are extracted bundle
  outputs, not live TypeScript source modules.
- `codex-native/dist/*` is compiled output and should not be treated as
  source-of-truth runtime code in this repo.
