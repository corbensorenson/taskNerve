#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_NAME="${1:-manual}"
STAMP_FILE="$REPO_ROOT/.git/tasknerve-auto-install.stamp"
LOCK_DIR="$REPO_ROOT/.git/tasknerve-auto-install.lock"
STRICT="${TASKNERVE_DEV_AUTO_INSTALL_STRICT:-0}"
TIMEOUT_SECONDS="${TASKNERVE_DEV_AUTO_INSTALL_TIMEOUT_SECONDS:-180}"

log() {
  printf '[tasknerve-dev-auto-install] %s\n' "$*" >&2
}

read_active_version() {
  local active_bin="$1"
  python3 - "$active_bin" <<'PY'
import pathlib
import subprocess
import sys

bin_path = pathlib.Path(sys.argv[1])
if not bin_path.exists():
    raise SystemExit(0)

cmd = [str(bin_path), "--version"]
try:
    first_line = bin_path.read_bytes().splitlines()[:1]
except Exception:
    first_line = []
if first_line and first_line[0].startswith(b"#!"):
    cmd = ["/bin/bash", str(bin_path), "--version"]

try:
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
except Exception:
    raise SystemExit(0)

if completed.returncode == 0:
    sys.stdout.write(completed.stdout.strip())
PY
}

run_install() {
  python3 - "$REPO_ROOT" "$TIMEOUT_SECONDS" <<'PY'
import os
import subprocess
import sys

repo_root = sys.argv[1]
timeout = int(sys.argv[2])
cmd = [
    "bash",
    os.path.join(repo_root, "install.sh"),
    "--with-skill",
    "--overwrite-skill",
    "--no-path-update",
]
try:
    completed = subprocess.run(cmd, cwd=repo_root, timeout=timeout)
except subprocess.TimeoutExpired:
    print(
        f"[tasknerve-dev-auto-install] warning: local tasknerve refresh timed out after {timeout}s",
        file=sys.stderr,
    )
    sys.exit(124)
sys.exit(completed.returncode)
PY
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

RELEVANT_FILES=()
while IFS= read -r -d '' file; do
  RELEVANT_FILES+=("$file")
done < <(
  git -C "$REPO_ROOT" ls-files -z -- \
    Cargo.toml \
    Cargo.lock \
    build.rs \
    src \
    skills \
    templates \
    scripts/install.sh \
    scripts/install-unix.sh \
    scripts/install_codex_skill.sh \
    scripts/tasknerve-gui \
    README.md \
    CHANGELOG.md
)

if [[ "${#RELEVANT_FILES[@]}" -eq 0 ]]; then
  exit 0
fi

CURRENT_STAMP="$(
  printf '%s\0' "${RELEVANT_FILES[@]}" \
    | xargs -0 shasum \
    | shasum \
    | awk '{print $1}'
)"

if [[ -f "$STAMP_FILE" ]] && [[ "$(cat "$STAMP_FILE")" == "$CURRENT_STAMP" ]]; then
  exit 0
fi

log "refreshing local tasknerve install after ${HOOK_NAME}"
if run_install; then
  printf '%s\n' "$CURRENT_STAMP" >"$STAMP_FILE"
  ACTIVE_BIN="$(command -v tasknerve || true)"
  ACTIVE_VERSION="$(read_active_version "$ACTIVE_BIN" 2>/dev/null || true)"
  log "active binary: ${ACTIVE_BIN:-unknown}"
  if [[ -n "$ACTIVE_VERSION" ]]; then
    log "active version: $ACTIVE_VERSION"
  fi
else
  EXIT_CODE="$?"
  if [[ "$EXIT_CODE" == "124" ]]; then
    log "warning: local tasknerve refresh timed out"
  else
    log "warning: local tasknerve refresh failed"
  fi
  if [[ "$STRICT" == "1" ]]; then
    exit 1
  fi
fi
