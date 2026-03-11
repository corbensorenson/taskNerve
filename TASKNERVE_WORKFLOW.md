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
- Keep outputs free of secrets, credentials, and personal information.
