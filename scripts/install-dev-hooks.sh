#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git -C "$REPO_ROOT" config core.hooksPath "$REPO_ROOT/githooks"
printf '[fugit-dev-hooks] core.hooksPath=%s\n' "$REPO_ROOT/githooks"
printf '[fugit-dev-hooks] enabled hooks: post-checkout, post-commit, post-merge, post-rewrite, pre-push\n'
printf '[fugit-dev-hooks] auto install script: %s\n' "$REPO_ROOT/scripts/auto-install-dev.sh"
