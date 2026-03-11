#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
tasknerve native installer

Usage:
  bash scripts/install-unix.sh [--platform macos] [native sync args...]

Notes:
  - The Rust installer path has been deprecated.
  - The active install/sync path now patches the local Codex desktop app through the native JS workspace in `codex-native/`.
  - Linux is not supported by this native cutover script yet.
USAGE
}

PLATFORM=""
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$PLATFORM" ]]; then
  case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux) PLATFORM="linux" ;;
    *)
      echo "Unsupported Unix platform: $(uname -s)" >&2
      exit 1
      ;;
  esac
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$PLATFORM" != "macos" || "$(uname -s)" != "Darwin" ]]; then
  echo "The native Codex TaskNerve cutover currently supports macOS only." >&2
  exit 1
fi

cd "$REPO_ROOT/codex-native"
npm install
node ./scripts/sync-codex-tasknerve.mjs "${ARGS[@]}"
