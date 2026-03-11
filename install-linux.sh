#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "The Codex-native TaskNerve cutover is currently supported on macOS only." >&2
echo "The archived Rust/Linux installer path has been removed from the live system." >&2
exit 1
