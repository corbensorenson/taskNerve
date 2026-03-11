---
name: tasknerve
description: Codex-native multi-agent project orchestration. Use when work should be coordinated through TaskNerve tasks, controller policy, project documents, and native Codex threads.
---

# TaskNerve Skill

Use this skill when the user wants project work managed through the native TaskNerve surfaces inside Codex.

## Activation Criteria

Use this skill when any of the following are true:
- The user wants to coordinate multiple Codex threads on one project.
- The user wants TaskNerve tasks, controller behavior, heartbeats, or worker routing changed.
- The user wants `project_goals.md`, `project_manifest.md`, or `contributing ideas.md` refined as project contracts.
- The user wants TaskNerve traces, project settings, or project-specific automation behavior adjusted.
- The user wants Codex-native TaskNerve UI or integration work.

## Runtime Rules

- The live TaskNerve path on `codex/codex-native` is native JS/TS inside Codex.
- The archived Rust runtime under [deprecated/rust/](/Users/adimus/Documents/taskNerve/deprecated/rust/) is reference-only.
- Do not steer users toward a TaskNerve CLI workflow on this branch.
- Prefer the native TaskNerve page, task drawer, controller automation, and project document editor inside Codex.

## Native Workflow

1. Work from the active Codex project context.
2. Treat TaskNerve as the project orchestration layer:
- the TaskNerve page is for project settings and per-project policies
- the task drawer is the main queue interaction surface
- the controller thread owns backlog shaping, maintenance passes, and worker orchestration

3. Treat these files as durable contracts:
- [project_goals.md](/Users/adimus/Documents/taskNerve/project_goals.md)
- [project_manifest.md](/Users/adimus/Documents/taskNerve/project_manifest.md)
- [contributing ideas.md](/Users/adimus/Documents/taskNerve/contributing%20ideas.md)

4. When changing TaskNerve itself, put new portable logic in:
- [codex-native/](/Users/adimus/Documents/taskNerve/codex-native/)
- [TASKNERVE_CODEX_MAIN_BRIDGE.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js)
- [TASKNERVE_CODEX_PANEL.js](/Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js)

5. Refresh the local app after native changes:

```bash
bash /Users/adimus/Documents/taskNerve/install-macos.sh --app "/Applications/Codex TaskNerve.app"
```

6. Run native checks before closing work:

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js
node --check /Users/adimus/Documents/taskNerve/templates/TASKNERVE_CODEX_PANEL.js
```

## Controller Contract

The controller should:
- familiarize itself with the project state
- refine and lock `project_goals.md` and `project_manifest.md` with the user
- use `contributing ideas.md` as optional inspiration/reference input
- populate and maintain the TaskNerve task queue
- keep worker threads fed without building prompt backlogs
- alternate development and maintenance/debt-reduction passes according to project policy

## UI Contract

The preferred UX is:
- one settings-first TaskNerve page
- one task drawer opened from the task-count chip in Codex chrome
- project docs listed inside each project grouping in the sidebar
- editing that stays inside Codex whenever possible
