#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat <<MSG
TaskNerve is now direct Codex-native integration only.

No app-bundle patching or injection step is supported.

Integration entrypoints:
  $REPO_ROOT/codex-native/src/integration/taskNerveService.ts
  $REPO_ROOT/codex-native/src/integration/codexTaskNerveHostRuntime.ts

Run native checks:
  cd $REPO_ROOT/codex-native
  npm install
  npm run typecheck
  npm test
MSG
