# TaskNerve Native Codex Integration Plan

## Goal

Make TaskNerve feel built into Codex through direct host integration:
- no iframe
- no second app
- no second sign-in
- no user-facing TaskNerve CLI
- no Rust in the live runtime path
- no app-bundle patching/injection path

Codex remains the host for threads, auth, windows, and desktop UX. TaskNerve remains the orchestration layer for tasks, controller policy, traces, project docs, and task-aware automation.

## Steady-State Architecture

Codex owns:
- authenticated inference
- thread creation and thread navigation
- workspace and repo context
- desktop shell and window management
- host chrome and native controls

TaskNerve owns:
- project-scoped queue logic
- controller and worker orchestration policy
- project document lifecycle
- task sorting/filtering/queue semantics
- repo-local settings and registry state

## Implementation Direction

Native TaskNerve work targets:
- TypeScript-first domain modules in `codex-native/src/domain`
- persistence modules in `codex-native/src/io`
- direct host integration modules in `codex-native/src/integration`
- typed contracts at process and persistence boundaries
- repo-local persistence as durable source of truth

## Development Model

Main loop:
1. edit `codex-native/src`
2. run native checks
3. validate behavior through direct host integration seams

Run checks:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

## Explicit Non-Goals

The branch should not drift back toward:
- a standalone TaskNerve CLI as the primary user surface
- a Rust sidecar
- a second auth path
- browser-only board workflows
- any patch/injection-based runtime integration
