#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SRC_SKILLS_ROOT="$REPO_ROOT/skills"
OVERWRITE="${OVERWRITE:-1}"

if [[ ! -d "$SRC_SKILLS_ROOT" ]]; then
  echo "missing source skills directory: $SRC_SKILLS_ROOT" >&2
  exit 1
fi

mkdir -p "$CODEX_HOME_DIR/skills"

installed=0
for src_dir in "$SRC_SKILLS_ROOT"/*; do
  [[ -d "$src_dir" ]] || continue
  skill_id="$(basename "$src_dir")"
  [[ "$skill_id" == .* ]] && continue
  dst_dir="$CODEX_HOME_DIR/skills/$skill_id"
  if [[ "$OVERWRITE" == "1" ]]; then
    rm -rf "$dst_dir"
  fi
  cp -R "$src_dir" "$dst_dir"
  echo "Installed Codex skill: $skill_id -> $dst_dir"
  installed=$((installed + 1))
done

if [[ "$installed" -eq 0 ]]; then
  echo "no skills found under: $SRC_SKILLS_ROOT" >&2
  exit 1
fi
