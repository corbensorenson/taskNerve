#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
tasknerve native installer

Usage:
  bash scripts/install-unix.sh

Notes:
  - TaskNerve now uses direct Codex-native integration modules.
  - App-bundle patching/injection is not supported.
  - There is no legacy fallback patch path.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cat <<MSG
TaskNerve uses direct Codex-native integration only.

Integration entrypoints:
  $REPO_ROOT/codex-native/src/integration/taskNerveService.ts
  $REPO_ROOT/codex-native/src/integration/codexTaskNerveHostRuntime.ts

Run native checks:
  cd $REPO_ROOT/codex-native
  npm install
  npm run typecheck
  npm test
MSG
