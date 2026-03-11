---
name: tasknerve
description: Codex-native multi-agent project orchestration. Use when work should be coordinated through TaskNerve tasks, controller policy, project documents, and native Codex threads.
---

# TaskNerve Skill

Use this skill when project work should be managed through native TaskNerve surfaces in Codex.

## Activation Criteria

Use this skill when any of the following are true:
- The user wants to coordinate multiple Codex threads on one project.
- The user wants TaskNerve tasks, controller behavior, heartbeats, or worker routing changed.
- The user wants `project_goals.md`, `project_manifest.md`, or `contributing ideas.md` refined as project contracts.
- The user wants TaskNerve traces, project settings, or project-specific automation behavior adjusted.
- The user wants Codex-native TaskNerve integration work.

## Runtime Rules

- The live TaskNerve path on `codex/codex-native` is TypeScript inside Codex host runtime seams.
- The archived Rust runtime is reference-only and not part of the live path.
- Do not steer users toward a TaskNerve CLI workflow on this branch.
- Do not add app-bundle patching, runtime injection, localhost bridge services, or DOM mutation overlays.
- If a required host surface is missing, document the host gap and implement through typed Codex host-service contracts.
- Alpha single-target rule: implement product changes in exactly one source path, `codex-native/src`.
- Do not maintain parallel dev/test runtime trees, duplicate editable bundle copies, or split implementation pipelines for the same user-steered feature.
- Treat `target/*` extracts and generated bundles as build/runtime artifacts; they are not source-of-truth code.
- If runtime extract verification is needed, use one canonical extract tree only: `target/codex-tasknerve-app-live-extract` (alias `target/codex-tasknerve-app-src`).

## Native Workflow

1. Work from active Codex project context.
2. Treat TaskNerve as orchestration layer:
- the TaskNerve page is for project settings and per-project policies
- the task drawer is the primary queue interaction surface
- the controller thread owns backlog shaping, maintenance passes, and worker orchestration

3. Treat these files as durable contracts:
- [project_goals.md](/Users/adimus/Documents/taskNerve/project_goals.md)
- [project_manifest.md](/Users/adimus/Documents/taskNerve/project_manifest.md)
- [contributing ideas.md](/Users/adimus/Documents/taskNerve/contributing%20ideas.md)

4. Keep new logic in modular native paths:
- [codex-native/src/integration/](/Users/adimus/Documents/taskNerve/codex-native/src/integration)
- [codex-native/src/domain/](/Users/adimus/Documents/taskNerve/codex-native/src/domain)
- [codex-native/src/io/](/Users/adimus/Documents/taskNerve/codex-native/src/io)

5. Validate native behavior through direct integration flow.

6. Run checks before closing work:

Human-controlled fast path (default when user is actively steering):
- run only the smallest meaningful checks for touched native modules
- do not create parallel implementation tracks to satisfy test/process ceremony

Autonomous/hardening path:
- run full typecheck and test gates before closure

```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
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

Preferred UX:
- one settings-first TaskNerve page
- one task drawer opened from the task-count chip in Codex chrome
- project docs listed inside each project grouping in the sidebar
- views rendered with Codex host components and styling conventions
