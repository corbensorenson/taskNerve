#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Publish fugit Codex skill to a shared directory.

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
SRC_SKILL_DIR="$REPO_ROOT/skills/fugit"
DEST_SKILL_DIR="$DEST_ROOT/fugit"

if [[ ! -d "$SRC_SKILL_DIR" ]]; then
  echo "missing source skill: $SRC_SKILL_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"
if [[ ! -w "$DEST_ROOT" ]]; then
  echo "destination is not writable: $DEST_ROOT" >&2
  echo "choose a writable path with --dest or rerun with appropriate permissions" >&2
  exit 1
fi
if [[ -e "$DEST_SKILL_DIR" ]]; then
  if [[ "$OVERWRITE" -eq 1 ]]; then
    rm -rf "$DEST_SKILL_DIR"
  else
    echo "destination exists: $DEST_SKILL_DIR (use --overwrite)" >&2
    exit 1
  fi
fi

cp -R "$SRC_SKILL_DIR" "$DEST_SKILL_DIR"
chmod -R a+rX "$DEST_SKILL_DIR"

echo "Published shared skill to: $DEST_SKILL_DIR"
