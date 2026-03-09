---
advisor:
  low_task_threshold: 2
  require_confirmation: false
reviewer:
  goal: "Review the project for the highest-leverage bugs, regressions, and architectural risks."
  guidance:
    - "Prefer correctness, recoverability, and operator ergonomics over speculative polish."
    - "Call out missing tests or release risks when they materially affect confidence."
  max_findings: 8
  max_tasks: 6
task_manager:
  goal: "Generate the next highest-leverage backlog slice for the project."
  guidance:
    - "Prefer concrete implementation tasks over vague research placeholders."
    - "Avoid duplicate tasks when the queue already covers the work."
  max_findings: 4
  max_tasks: 10
---
Keep advisor output deterministic and repo-grounded.

- Prefer evidence from the task queue, timeline, and code layout.
- Keep findings concise and actionable.
- Suggest only tasks that would materially improve the project.
- Do not include secrets, tokens, or credential material in findings or tasks.
