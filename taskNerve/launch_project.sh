#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[taskNerve] Launching project workflow in: $ROOT_DIR"
echo "[taskNerve] Tip: customize taskNerve/launch_project.sh for project-specific startup commands."
