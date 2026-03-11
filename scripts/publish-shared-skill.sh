#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Publish tasknerve Codex skill to a shared directory.

Usage:
  bash scripts/publish-shared-skill.sh [options]

Options:
  --dest <path>     Shared destination root (default is OS-specific)
  --overwrite       Remove existing destination skill before copy
  -h, --help        Show help
USAGE
}

default_dest_root() {
  case "$(uname -s)" in
    Darwin)
      echo "/Users/Shared/codex-skills"
      ;;
    Linux)
      if [[ -w "/usr/local/share" ]]; then
        echo "/usr/local/share/codex-skills"
      else
        echo "${HOME}/.local/share/codex-skills"
      fi
      ;;
    *)
      echo "${HOME}/.local/share/codex-skills"
      ;;
  esac
}

DEST_ROOT="$(default_dest_root)"
OVERWRITE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST_ROOT="$2"
      shift 2
      ;;
    --overwrite)
      OVERWRITE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SKILLS_ROOT="$REPO_ROOT/skills"

if [[ ! -d "$SRC_SKILLS_ROOT" ]]; then
  echo "missing source skills root: $SRC_SKILLS_ROOT" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"
if [[ ! -w "$DEST_ROOT" ]]; then
  echo "destination is not writable: $DEST_ROOT" >&2
  echo "choose a writable path with --dest or rerun with appropriate permissions" >&2
  exit 1
fi
published=0
for src_dir in "$SRC_SKILLS_ROOT"/*; do
  [[ -d "$src_dir" ]] || continue
  skill_id="$(basename "$src_dir")"
  [[ "$skill_id" == .* ]] && continue
  dest_skill_dir="$DEST_ROOT/$skill_id"
  if [[ -e "$dest_skill_dir" ]]; then
    if [[ "$OVERWRITE" -eq 1 ]]; then
      rm -rf "$dest_skill_dir"
    else
      echo "destination exists: $dest_skill_dir (use --overwrite)" >&2
      exit 1
    fi
  fi
  cp -R "$src_dir" "$dest_skill_dir"
  chmod -R a+rX "$dest_skill_dir"
  echo "Published shared skill: $skill_id -> $dest_skill_dir"
  published=$((published + 1))
done

if [[ "$published" -eq 0 ]]; then
  echo "no skills found under: $SRC_SKILLS_ROOT" >&2
  exit 1
fi
