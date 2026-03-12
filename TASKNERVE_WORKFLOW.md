---
advisor:
  low_task_threshold: 2
  require_confirmation: false
reviewer:
  goal: "Review tasknerve for missing functionality, regressions, and multi-agent UX risks."
  guidance:
    - "Prioritize agent ergonomics, recoverability, and deterministic behavior."
    - "Treat broken native TaskNerve or Codex integration flows as high leverage because they block operator trust."
  max_findings: 8
  max_tasks: 6
task_manager:
  goal: "Generate the next highest-leverage backlog for tasknerve."
  guidance:
    - "Prefer concrete native UI, integration, docs, and test tasks."
    - "Keep the queue focused on features that improve real-world agent workflows."
  max_findings: 4
  max_tasks: 10
---
Use the repository state as the source of truth.

- Prefer tasks that improve tasknerve's reliability, auditability, and ease of use.
- Keep suggestions small enough to import cleanly into the queue.
- Avoid duplicate backlog items when the task system already tracks the work.
- Keep one alpha implementation pipeline only: `codex-native/src` is source-of-truth; runtime extracts are artifacts.
- When local desktop UI/runtime changes are expected to be visible immediately, deploy and verify with:
  - `bash /Users/adimus/Documents/taskNerve/scripts/deploy-live-extract-to-installed-app.sh`
- Treat these docs as required for project readiness:
  - `project_goals.md`
  - `project_manifest.md`
  - `contributing_ideas.md` (legacy `contributing ideas.md` may exist)
  - `levers_pitfalls.md`
  - `research.md`
  - `taskNerve/creating_project_skill.md`
  - `taskNerve/using_project_skill.md`
- For GitHub issues integration:
  - ingest issues into review candidates first
  - use issue filter controls (trust threshold, blocked labels/authors, required labels)
  - only promote approved candidates into tasks
- For Discord integration:
  - configure webhook per project in TaskNerve settings (`discord_webhook_url`, enable toggle)
  - use `discord_mute_when_local_active` to silence webhook updates while actively using desktop app
  - inbound chat replies require relay to local endpoint `POST /tasknerve/discord/incoming` (webhook alone is outbound-only)
- Keep outputs free of secrets, credentials, and personal information.
