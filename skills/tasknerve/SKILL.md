---
name: tasknerve
description: Use TaskNerve inside Codex to run project work through controller/worker queues, project settings, and repo-local TaskNerve contracts.
---

# TaskNerve Skill (Use)

Use this skill when the user wants to operate project work through TaskNerve's native Codex workflow.

If you want, I can next add a tiny “skill routing” note so requests automatically prefer tasknerve-creator for platform/dev work and tasknerve for orchestration/use.

## Activation Criteria

Use this skill when any of the following are true:
- The user wants to coordinate controller and worker threads on a project.
- The user wants to manage TaskNerve queue flow, heartbeats, or handoffs.
- The user wants project-level TaskNerve settings adjusted.
- The user wants `project_goals.md`, `project_manifest.md`, or `contributing ideas.md` kept aligned with active work.
- The user wants day-to-day TaskNerve operation, triage, and orchestration.

Use `tasknerve-creator` instead when the request is to build/modify TaskNerve itself.

## Runtime Rules

- Operate through native Codex TaskNerve surfaces first.
- Keep orchestration state repo-local and project-contract driven.
- Do not introduce alternate runtime paths while performing usage/orchestration work.

## Native Workflow

1. Work from the active project and current Codex thread context.
2. Treat TaskNerve as the project orchestration layer:
- the TaskNerve page is for project settings and per-project policies
- the task drawer is the primary queue interaction surface
- the controller thread owns backlog shaping, maintenance passes, and worker orchestration

3. Treat these files as durable contracts:
- [project_goals.md](/Users/adimus/Documents/taskNerve/project_goals.md)
- [project_manifest.md](/Users/adimus/Documents/taskNerve/project_manifest.md)
- [contributing ideas.md](/Users/adimus/Documents/taskNerve/contributing%20ideas.md)

4. Keep workers fed with concrete, ready work and avoid idle churn.
5. Capture user-facing state clearly: active project, controller ownership, queue health, and blockers.

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
