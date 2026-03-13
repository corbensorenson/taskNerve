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
- The user wants to ingest external issue streams (for example GitHub issues) into TaskNerve with review gates.
- The user wants TaskNerve Discord bridge behavior managed (webhook updates, mute policy, inbound relay).
- The user wants project-level TaskNerve settings adjusted.
- The user wants TaskNerve update interceptor behavior managed (critical fast updates, phase-two review issues, channel state).
- The user wants project docs (`project_goals.md`, `project_manifest.md`, `contributing_ideas.md`, `levers_pitfalls.md`, `research.md`, `taskNerve/creating_project_skill.md`, `taskNerve/using_project_skill.md`) kept aligned with active work.
- The user wants day-to-day TaskNerve operation, triage, and orchestration.

Use `tasknerve-creator` instead when the request is to build/modify TaskNerve itself.

## Runtime Rules

- Operate through native Codex TaskNerve surfaces first.
- Keep orchestration state repo-local and project-contract driven.
- Do not introduce alternate runtime paths while performing usage/orchestration work.
- Never hand-edit generated bundle/runtime artifacts under `target/*`.
- Never ship "bundle patching" or injection-style workflows in active runtime paths.
- If legacy patch scripts/artifacts are discovered, move them to `/deprecated` and document the source-first replacement.

## Native Workflow

1. Work from the active project and current Codex thread context.
2. Treat TaskNerve as the project orchestration layer:
- the TaskNerve page is for project settings and per-project policies
- the task drawer is the primary queue interaction surface
- the controller thread owns backlog shaping, maintenance passes, and worker orchestration

3. Treat these files as durable contracts:
- [project_goals.md](/Users/adimus/Documents/taskNerve/project_goals.md)
- [project_manifest.md](/Users/adimus/Documents/taskNerve/project_manifest.md)
- `contributing_ideas.md` (legacy name may still be `contributing ideas.md` in older repos)
- `levers_pitfalls.md`
- `research.md`
- `taskNerve/creating_project_skill.md`
- `taskNerve/using_project_skill.md`

4. Keep workers fed with concrete, ready work and avoid idle churn.
5. Capture user-facing state clearly: active project, controller ownership, queue health, and blockers.
6. For external issue intake, prefer review-first candidate flow with approve/reject controls before task creation.
7. For Discord use:
- keep webhook URL per-project
- respect local mute toggle when user is actively in desktop app
- treat webhook as outbound; inbound replies must be relayed to TaskNerve `/tasknerve/discord/incoming`

## Controller Contract

The controller should:
- familiarize itself with the project state
- refine and lock `project_goals.md` and `project_manifest.md` with the user
- keep `contributing_ideas.md`, `levers_pitfalls.md`, and `research.md` current
- keep `taskNerve/creating_project_skill.md` and `taskNerve/using_project_skill.md` current
- populate and maintain the TaskNerve task queue
- operate issue intake with safety: candidate queue first, then approve/reject before promotion into tasks
- keep worker threads fed without building prompt backlogs
- alternate development and maintenance/debt-reduction passes according to project policy
- run deterministic self-improvement passes based on runtime signals (watchdog resets, quality-gate blocks, git-sync instability) with bounded cadence
- break work into mostly xs/s tasks by default; split anything broad until each task has clear, verifiable done conditions
- enforce worker completion before reassignment:
  - workers must end each check-in with `STATUS: CONTINUE` or `STATUS: FINISHED`
  - if `STATUS: CONTINUE`, do not assign a new task; continue the current one
  - only assign a new task after `STATUS: FINISHED` and queue state confirms completion
- use a structured task template so workers have enough context to execute without ambiguity:
  - `title`
  - `objective`
  - `task_type`
  - `subsystem`
  - `files_in_scope`
  - `out_of_scope`
  - `acceptance_criteria`
  - `deliverables`
  - `verification_steps`
  - `implementation_notes`
  - `risk_notes`
  - `estimated_effort`

## Project Onboarding Gate

Before treating a project as active in TaskNerve, ensure:
- project root exists
- `taskNerve/` project folder exists (or `.tasknerve/` where runtime currently stores state)
- project `.gitignore` exists
- required docs exist and are initialized:
  - `project_goals.md`
  - `project_manifest.md`
  - `contributing_ideas.md`
  - `levers_pitfalls.md`
  - `research.md`
  - `taskNerve/project_goals.md`
  - `taskNerve/project_manifest.md`
  - `taskNerve/contributing_ideas.md`
  - `taskNerve/levers_pitfalls.md`
  - `taskNerve/research.md`
  - `taskNerve/creating_project_skill.md`
  - `taskNerve/using_project_skill.md`
  - `taskNerve/launch_project.sh`
  - `taskNerve/project_trace.ndjson` (created/maintained by deterministic trace sync)
  - `taskNerve/project_trace_manifest.json` (trace sync status + counters)
- imports include a review pass that fills these docs and confirms them with the user

## UI Contract

Preferred UX:
- one settings-first TaskNerve page
- one task drawer opened from the task-count chip in Codex chrome
- project docs listed inside each project grouping in the sidebar
- controller thread should be clearly designated in each project group
- non-controller threads should be presented under an `/agents` section
- views rendered with Codex host components and styling conventions
