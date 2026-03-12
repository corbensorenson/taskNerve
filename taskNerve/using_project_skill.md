# Using taskNerve Skill

Project: taskNerve

## Purpose
Define day-to-day execution through controller + agents with project contracts as the operating source of truth.

## Controller Contract
- Keep goals and manifest synchronized with real project direction.
- Maintain a ready backlog of concrete tasks.
- Assign and rebalance worker tasks to avoid idle agents.
- Run periodic maintenance/debt passes.
- Capture proven levers and pitfalls in docs.

## Agent Contract
- Execute one scoped task at a time.
- Report outputs, risks, and blockers quickly.
- Avoid speculative side quests outside assigned scope.
- Write back research/learnings to project contracts when relevant.

## Operational Rules
- Prefer deterministic actions and explicit state transitions.
- Use in-app markdown editor for project contract maintenance.
- Escalate controller reset when controller thread health degrades.
- Keep Discord/issue integrations configurable and user-controlled.
- For upstream Codex compatibility, use update interceptor two-phase flow:
- phase 1 critical updates auto-run to preserve functionality
- phase 2 non-critical follow-ups are sent to GitHub issues and require owner approval
- Apply autoresearch-style operations at system level:
- fixed, repeated improvement loop
- single-task scoped changes with explicit metrics
- keep/discard behavior driven by deterministic gates
- bounded automation (cooldown + open-task limits) to prevent queue spam

## Quality Rules
- Prioritize correctness and recoverability over novelty.
- Keep performance overhead visible and bounded.
- Keep UX consistent with native Codex behavior.
