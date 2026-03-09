#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_NAME="${1:-manual}"
STAMP_FILE="$REPO_ROOT/.git/fugit-auto-install.stamp"
LOCK_DIR="$REPO_ROOT/.git/fugit-auto-install.lock"
STRICT="${FUGIT_DEV_AUTO_INSTALL_STRICT:-0}"

log() {
  printf '[fugit-dev-auto-install] %s\n' "$*" >&2
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
    scripts/fugit-gui \
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

log "refreshing local fugit install after ${HOOK_NAME}"
if bash "$REPO_ROOT/install.sh" --with-skill --overwrite-skill --no-path-update; then
  printf '%s\n' "$CURRENT_STAMP" >"$STAMP_FILE"
  ACTIVE_BIN="$(command -v fugit || true)"
  ACTIVE_VERSION="$(fugit --version 2>/dev/null || true)"
  log "active binary: ${ACTIVE_BIN:-unknown}"
  if [[ -n "$ACTIVE_VERSION" ]]; then
    log "active version: $ACTIVE_VERSION"
  fi
else
  log "warning: local fugit refresh failed"
  if [[ "$STRICT" == "1" ]]; then
    exit 1
  fi
fi
