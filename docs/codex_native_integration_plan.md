# TaskNerve Native Codex Integration Plan

## Goal

Make TaskNerve feel like a built-in part of Codex:
- no iframe
- no second app
- no second sign-in
- no user-facing TaskNerve CLI
- no Rust in the live runtime path

Codex should remain the host for threads, auth, windows, and desktop UX. TaskNerve should remain the orchestration layer for tasks, controller policy, traces, project docs, and task-aware automation.

## Steady-State Architecture

Codex owns:
- authenticated inference
- thread creation and thread navigation
- workspace and repo context
- desktop shell and window management
- host chrome and native controls

TaskNerve owns:
- project-scoped queue logic
- task drawer and TaskNerve settings page
- controller and worker orchestration
- project document lifecycle
- trace capture and export policy
- TaskNerve branch state and workflow policy

## Implementation Direction

Native TaskNerve work should continue to move toward:
- TypeScript-first domain modules in `codex-native/`
- renderer and main-process behavior that mirrors Codex's own style
- in-app routes and host services instead of a second binary interface
- repo-local persistence as the durable source of truth

## Development Model

The main developer loop is:
1. edit `codex-native/` or `templates/`
2. run native checks
3. resync `Codex TaskNerve.app`
4. review the result directly inside Codex

The supported sync command is:

```bash
bash /Users/adimus/Documents/taskNerve/install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

## Explicit Non-Goals

The branch should not drift back toward:
- a standalone TaskNerve CLI as the primary user surface
- a Rust sidecar
- a second auth path
- a browser-only board outside Codex
