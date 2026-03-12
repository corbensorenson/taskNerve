# Creating taskNerve Skill

Project: taskNerve

## Purpose
Define the deterministic project creation/import workflow so every project enters TaskNerve in a usable, contract-complete state.

## Deterministic Workflow
1. Resolve or create project root.
2. Ensure root `.gitignore` exists.
3. Ensure `taskNerve/` exists.
4. Ensure required root contracts exist.
5. Ensure required `taskNerve/` contracts exist.
6. Ensure `taskNerve/launch_project.sh` exists and is executable.
7. Register project in TaskNerve and set active context.
8. Bootstrap controller thread.
9. For imports, run controller review pass to complete goals/manifest/ideas/levers/research with user confirmation.

## Required Contracts
- `project_goals.md`
- `project_manifest.md`
- `contributing ideas.md`
- `levers_pitfalls.md`
- `research.md`
- `taskNerve/creating_project_skill.md`
- `taskNerve/using_project_skill.md`
- `taskNerve/launch_project.sh`

## Exit Criteria
- Project appears in sidebar as a valid TaskNerve project.
- Controller thread is designated and visible.
- Agent folder/section is ready for worker threads.
- Contract docs are populated enough for immediate execution.
