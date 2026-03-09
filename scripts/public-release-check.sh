#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[release-check] formatting"
cargo fmt --check

echo "[release-check] lint"
cargo clippy --all-targets --all-features -- -D warnings

echo "[release-check] tests"
cargo test

if command -v cargo-audit >/dev/null 2>&1; then
  echo "[release-check] dependency advisories"
  cargo audit
else
  echo "[release-check] dependency advisories skipped (cargo-audit not installed)"
fi

echo "[release-check] installer smoke (unix)"
TMP_BIN="$(mktemp -d /tmp/tasknerve-release-bin-XXXXXX)"
TMP_HOME="$(mktemp -d /tmp/tasknerve-release-home-XXXXXX)"
CODEX_HOME="$(mktemp -d /tmp/tasknerve-release-codex-XXXXXX)" \
HOME="$TMP_HOME" \
  bash ./install.sh --install-dir "$TMP_BIN" --no-path-update --skip-rust-install --with-skill --overwrite-skill
"$TMP_BIN/tasknerve" --help >/dev/null
"$TMP_BIN/tasknerve" version --json >/dev/null
"$TMP_BIN/tasknerve" skill doctor >/dev/null
"$TMP_BIN/tasknerve" update show --json >/dev/null
"$TMP_BIN/tasknerve" update policy show --json >/dev/null
bash -n ./scripts/auto-install-dev.sh
bash -n ./scripts/install-dev-hooks.sh

echo "[release-check] identifier scan"
if rg -n --hidden -S "/Users/" -g '!target' -g '!.tasknerve' . | grep -v "/Users/Shared/" >/dev/null; then
  echo "[release-check] detected machine-specific macOS absolute user path references" >&2
  exit 1
fi
if rg -n --hidden -S "C:\\\\Users\\\\" -g '!target' -g '!.tasknerve' . >/dev/null; then
  echo "[release-check] detected machine-specific Windows absolute user path references" >&2
  exit 1
fi

echo "[release-check] complete"
