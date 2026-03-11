#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_NAME="${1:-manual}"
STAMP_FILE="$REPO_ROOT/.git/tasknerve-auto-install.stamp"
LOCK_DIR="$REPO_ROOT/.git/tasknerve-auto-install.lock"
STRICT="${TASKNERVE_DEV_AUTO_INSTALL_STRICT:-0}"

log() {
  printf '[tasknerve-dev-auto-install] %s\n' "$*" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "native Codex TaskNerve auto-sync is macOS-only; skipping"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

RELEVANT_FILES=()
while IFS= read -r -d '' file; do
  RELEVANT_FILES+=("$file")
done < <(
  git -C "$REPO_ROOT" ls-files -z -- \
    codex-native \
    templates \
    skills \
    install-macos.sh \
    scripts/install-unix.sh \
    scripts/install_codex_skill.sh \
    README.md \
    CHANGELOG.md \
    project_goals.md \
    project_manifest.md \
    "contributing ideas.md"
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

log "resyncing Codex TaskNerve after ${HOOK_NAME}"
if bash "$REPO_ROOT/install-macos.sh" --app "/Applications/Codex TaskNerve.app"; then
  printf '%s\n' "$CURRENT_STAMP" >"$STAMP_FILE"
  log "native app sync complete"
else
  log "warning: native app sync failed"
  if [[ "$STRICT" == "1" ]]; then
    exit 1
  fi
fi
