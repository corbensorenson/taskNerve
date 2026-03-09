---
advisor:
  low_task_threshold: 2
  require_confirmation: false
reviewer:
  goal: "Review fugit for missing functionality, regressions, and multi-agent UX risks."
  guidance:
    - "Prioritize agent ergonomics, recoverability, and deterministic behavior."
    - "Treat broken CLI or GUI flows as high leverage because they block operator trust."
  max_findings: 8
  max_tasks: 6
task_manager:
  goal: "Generate the next highest-leverage backlog for fugit."
  guidance:
    - "Prefer concrete CLI, GUI, docs, and test tasks."
    - "Keep the queue focused on features that improve real-world agent workflows."
  max_findings: 4
  max_tasks: 10
---
Use the repository state as the source of truth.

- Prefer tasks that improve fugit's reliability, auditability, and ease of use.
- Keep suggestions small enough to import cleanly into the queue.
- Avoid duplicate backlog items when the task system already tracks the work.
- Keep outputs free of secrets, credentials, and personal information.
