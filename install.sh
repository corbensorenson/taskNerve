#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(uname -s)" in
  Darwin)
    exec bash "$REPO_ROOT/install-macos.sh" "$@"
    ;;
  Linux)
    exec bash "$REPO_ROOT/install-linux.sh" "$@"
    ;;
  *)
    echo "Unsupported OS for this installer: $(uname -s)" >&2
    echo "Use install-windows.ps1 on Windows." >&2
    exit 1
    ;;
esac
