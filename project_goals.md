# Project Goals

Status: draft
Managed by: TaskNerve
Last updated: 2026-03-11

This file locks the user-approved outcomes for TaskNerve. Technical implementation choices belong in `project_manifest.md`.

## Current Project Snapshot
- Repository: `taskNerve`
- Repo root: `/Users/adimus/Documents/taskNerve`
- Product model: one Codex-native TaskNerve system with direct host integration

### Detected implementation direction
- TypeScript-first integration through `codex-native/src/integration`
- Host-facing orchestration logic under `codex-native/src`
- Archived Rust runtime retained only as historical reference outside the live path

## Overarching Goals
- [ ] Make TaskNerve feel fully built into Codex host workflows.
- [ ] Keep project/task/controller workflows fully inside Codex.
- [ ] Let users manage projects, tasks, controller policy, traces, and project docs without leaving Codex.
- [ ] Keep repo state durable and portable through `.tasknerve/` plus standardized root markdown contract files.

## Non-Goals
- [ ] Do not restore a user-facing CLI as the primary path.
- [ ] Do not bring the archived Rust runtime back into the live product path.
- [ ] Do not introduce patch/injection-based runtime behavior.

## Constraints
- [ ] Stay close to Codex native implementation style and UX.
- [ ] Keep the active runtime TypeScript-first.
- [ ] Keep integration seams explicit, typed, and test-covered.
- [ ] Keep multi-project workflows fast, low-friction, and visually coherent.

## Open Questions For The User
- [ ] Which Codex UI surfaces should TaskNerve integrate with first (settings page, drawer, project tree, all)?
- [ ] Which controller automations should remain user-controlled versus fully automatic?
- [ ] Which styling tokens/components from Codex should be treated as required for TaskNerve views?

## Lock Status
- [ ] Mark this file as locked once the goals are stable.
