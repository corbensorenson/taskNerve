# TaskNerve Project Manifest

Project: taskNerve
Status: active

## Runtime Contract
- Canonical runtime target: live extract at `target/codex-tasknerve-app-live-extract`.
- Desktop host: Electron main process + Codex webview bundle.
- Local bridge: TaskNerve HTTP routes on loopback for native project operations.
- Persisted state: project-local `.tasknerve/` + repo contracts.

## Required Project Contracts
Root-level docs:
- `project_goals.md`
- `project_manifest.md`
- `contributing ideas.md`
- `levers_pitfalls.md`
- `research.md`

TaskNerve folder docs:
- `taskNerve/project_goals.md`
- `taskNerve/project_manifest.md`
- `taskNerve/contributing_ideas.md`
- `taskNerve/levers_pitfalls.md`
- `taskNerve/research.md`
- `taskNerve/creating_project_skill.md`
- `taskNerve/using_project_skill.md`
- `taskNerve/launch_project.sh`

## UI Contract
- One project row with deterministic action buttons.
- Controller thread displayed as the top project thread.
- Agent threads grouped under `/agents`.
- In-app markdown editor is the default path for project contract edits.

## Performance Contract
- Prefer event-driven updates over periodic polling where host events exist.
- Cache and dedupe expensive loads by mtime/content where safe.
- Keep render churn low in thread display and sidebar project surfaces.

## Safety Contract
- Validate patched runtime JS before deploy.
- Keep bridge routes idempotent when possible.
- Fail clearly with actionable errors; avoid silent broken states.
