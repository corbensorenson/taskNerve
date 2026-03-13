#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Deterministic Codex TaskNerve local deploy (single entrypoint)

Usage:
  bash scripts/deploy-tasknerve-from-source.sh [options]

Options:
  --app-path PATH         Installed app bundle path (default: /Applications/Codex TaskNerve.app)
  --skip-install          Skip npm install in codex-native
  --skip-build            Skip npm run build in codex-native
  --skip-typecheck        Skip npm run typecheck in codex-native
  --skip-tests            Skip npm test in codex-native
  --skip-dmg              Skip DMG generation
  -h, --help              Show this help text

Notes:
  - Source of truth for implementation remains codex-native/src.
  - target/codex-tasknerve-app-live-extract is a generated runtime artifact, never an editable source tree.
  - This script is the intended single local path to update:
      1) local app install
      2) latest DMG installer
USAGE
}

APP_PATH="/Applications/Codex TaskNerve.app"
RUN_INSTALL=1
RUN_BUILD=1
RUN_TYPECHECK=1
RUN_TESTS=1
SKIP_DMG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-path)
      [[ $# -lt 2 ]] && { echo "missing value for --app-path" >&2; exit 1; }
      APP_PATH="$2"
      shift 2
      ;;
    --skip-install)
      RUN_INSTALL=0
      shift
      ;;
    --skip-build)
      RUN_BUILD=0
      shift
      ;;
    --skip-typecheck)
      RUN_TYPECHECK=0
      shift
      ;;
    --skip-tests)
      RUN_TESTS=0
      shift
      ;;
    --skip-dmg)
      SKIP_DMG=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$REPO_ROOT/codex-native"

if [[ ! -d "$NATIVE_DIR" ]]; then
  echo "missing native source path: $NATIVE_DIR" >&2
  exit 1
fi

echo "[tasknerve-deploy] enforcing single canonical generated runtime artifact"
bash "$REPO_ROOT/scripts/enforce-single-runtime-extract.sh"

pushd "$NATIVE_DIR" >/dev/null
if [[ "$RUN_INSTALL" == "1" ]]; then
  echo "[tasknerve-deploy] npm install (codex-native)"
  npm install
fi
if [[ "$RUN_BUILD" == "1" ]]; then
  echo "[tasknerve-deploy] npm run build (codex-native)"
  npm run build
fi
if [[ "$RUN_TYPECHECK" == "1" ]]; then
  echo "[tasknerve-deploy] npm run typecheck (codex-native)"
  npm run typecheck
fi
if [[ "$RUN_TESTS" == "1" ]]; then
  echo "[tasknerve-deploy] npm test (codex-native)"
  npm test
fi
popd >/dev/null

echo "[tasknerve-deploy] deploying built runtime artifact into installed app"
TASKNERVE_SKIP_DMG="$SKIP_DMG" \
  bash "$REPO_ROOT/scripts/deploy-installed-app-from-canonical-build.sh" "$APP_PATH"

echo "[tasknerve-deploy] complete"
