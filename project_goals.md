# Project Goals

Status: draft
Managed by: TaskNerve
Last updated: 2026-03-10

This file locks the user-approved outcomes for TaskNerve. Technical implementation choices belong in `project_manifest.md`.

## Current Project Snapshot
- Repository: `taskNerve`
- Repo root: `/Users/adimus/Documents/taskNerve`
- Product model: one Codex-native TaskNerve app, not a CLI plus sidecar

### Detected implementation direction
- TypeScript and JavaScript in a Codex/Electron-native runtime
- Native bridge and renderer patch assets under `templates/`
- Archived Rust runtime parked under `deprecated/rust/`

## Overarching Goals
- [ ] Make TaskNerve feel like a built-in part of Codex rather than an attached tool.
- [ ] Keep project/task/controller workflows fully inside the Codex desktop app.
- [ ] Let users manage projects, tasks, controller policy, traces, and project docs without leaving Codex.
- [ ] Keep repo state durable and portable through `.tasknerve/` plus the standardized root markdown contract files.

## Non-Goals
- [ ] Do not restore a user-facing CLI as the primary way to use TaskNerve.
- [ ] Do not bring the archived Rust runtime back into the live product path.
- [ ] Do not require a second provider login or a second app surface.

## Constraints
- [ ] Stay close to Codex's native implementation style and UX.
- [ ] Keep the active runtime TypeScript/JavaScript-first.
- [ ] Keep the patched app resilient across Codex desktop updates.
- [ ] Keep multi-project workflows fast, low-friction, and visually coherent.

## Open Questions For The User
- [ ] Which parts of the current native UX still feel the least like Codex?
- [ ] Which automation decisions should stay user-controlled versus fully automatic?
- [ ] How aggressive should controller-driven maintenance passes be compared with feature work?

## Lock Status
- [ ] Mark this file as locked once the goals are stable.
