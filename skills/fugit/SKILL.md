---
name: fugit
description: Agent-first timeline versioning workflow. Use when work should be checkpointed continuously, coordinated across multiple agents, and optionally bridged to GitHub with fugit-managed auth instead of direct day-to-day Git.
---

# Fugit Skill

Use this skill whenever the user wants version control work to be fast, low-friction, and safe for multi-agent collaboration.

## Activation Criteria

Use this skill when any of the following are true:
- The user asks for checkpointing progress with summaries/tags.
- The user asks to coordinate multiple agents in one repo.
- The user asks for timeline history/restore/branch operations.
- The user asks to publish to GitHub through fugit bridge mode.
- The user asks for MCP-based agent orchestration of versioning workflows.

## Workflow

1. Ensure timeline exists:
- `fugit --repo-root . init --branch trunk`

2. Inspect current state:
- `fugit --repo-root . status --limit 20`

3. Register projects when coordinating across multiple repos:
- `fugit project add --name <project_name> --repo-root <abs_repo_path> --set-default`
- `fugit project list`

4. Add shared tasks to the persistent queue:
- `fugit --repo-root . task add --title "Implement X" --priority 10 --tag compiler`
- `fugit --repo-root . task list --ready-only`
- For bulk backlog migration, import TSV once:
- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- For markdown checklist plans, import directly:
- `fugit --repo-root . task import --file /path/to/the_final_plan.md --format markdown`

5. Request next task (work-stealing by default on stale claims):
- `fugit --repo-root . task request --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- optional dry assignment: `fugit --repo-root . task request --agent <agent_id> --no-claim`

6. Capture progress as checkpoints:
- `fugit --repo-root . checkpoint --summary "<what changed>" --agent <agent_id> --tag <tag>`

7. Mark tasks done or release claim:
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id>`
- `fugit --repo-root . task release --task-id <task_id> --agent <agent_id>`
- Note: task lifecycle mutations (`add`, `claim`, `done`, `release`) are mirrored into timeline events automatically.

8. Review event history:
- `fugit --repo-root . log --limit 20`

9. Coordinate ownership when multiple agents touch overlapping files:
- `fugit --repo-root . lock add --pattern "src/**" --agent <agent_id> --ttl-minutes 30`
- `fugit --repo-root . lock list`

10. Publish through bridge mode (auth managed by fugit):
- `fugit --repo-root . bridge auth status`
- `fugit --repo-root . bridge auth login --token "$FUGIT_GIT_TOKEN" --helper <helper>`
- `fugit --repo-root . bridge sync-github --remote origin --branch <branch>`

11. Pull safely when local edits exist:
- `fugit --repo-root . bridge pull-github --remote origin --branch <branch> --autostash`

12. Serve MCP for multi-agent tool access:
- `fugit --repo-root . mcp serve`

13. Optional live task board window:
- CLI foreground: `fugit --repo-root . task gui`
- CLI background: `fugit --repo-root . task gui --background`
- Project-pinned GUI: `fugit --repo-root . task gui --project <project_name>`
- Timeline explorer: use the branch selector and `load older` in the GUI to scroll project history.
- MCP launch tool: `fugit_task_gui_launch`

## Git to Fugit Migration

Use this when the user has an existing Git project and wants to switch day-to-day coordination to fugit.

1. Preconditions:
- Git repository already exists.
- Working tree is clean or intentionally checkpointed.

2. Initialize fugit in the existing repo:
- `fugit --repo-root <repo_path> init --branch trunk`
- `fugit --repo-root <repo_path> status --json`

3. Register project for multi-repo agent sessions:
- `fugit project add --name <project_name> --repo-root <repo_path> --set-default`

4. Capture first fugit checkpoint baseline:
- `fugit --repo-root <repo_path> checkpoint --summary "fugit migration baseline" --agent <agent_id> --tag migration`

5. Move active work coordination to task queue:
- `fugit --repo-root <repo_path> task add --title "migration follow-up" --priority 10 --tag migration`
- `fugit --repo-root <repo_path> task request --agent <agent_id>`

6. Keep Git as bridge, not primary daily interface:
- `fugit --repo-root <repo_path> bridge sync-github --remote origin --branch <branch>`
- `fugit --repo-root <repo_path> bridge pull-github --remote origin --branch <branch> --autostash`

7. Agent handoff:
- Install/serve this same skill package so other agents follow fugit-first flow:
- CLI install: `fugit skill install-codex --overwrite`
- MCP distribution: call `fugit_skill_bundle`, then apply returned `skill_md` guidance.

## Task System Contract

Use this contract to keep task execution deterministic across agents.

1. Before starting implementation, request work:
- `fugit --repo-root . task request --agent <agent_id>`

2. If no task is returned, create an explicit task instead of silent work:
- `fugit --repo-root . task add --title "<deliverable>" --priority <n>`

3. Use dependencies for ordering rather than comments:
- `fugit --repo-root . task add --title "<child>" --depends-on <task_id>`
- For large imports, define key-based dependencies in TSV and let fugit resolve task IDs:
- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- TSV columns: `key<TAB>priority<TAB>tags_csv<TAB>depends_on_keys_csv<TAB>title<TAB>detail<TAB>agent`
- Markdown checklist ingestion is also supported:
- `fugit --repo-root . task import --file /path/to/the_final_plan.md --format markdown`
- Markdown import consumes unchecked lines (`- [ ]` / `* [ ]`) and ignores checked lines (`[x]`).

4. Keep ownership explicit:
- claim specific work when needed: `fugit --repo-root . task claim --task-id <task_id> --agent <agent_id>`
- release immediately on context switch: `fugit --repo-root . task release --task-id <task_id> --agent <agent_id>`

5. Close the loop:
- checkpoint progress: `fugit --repo-root . checkpoint --summary "<change>" --agent <agent_id> --tag <tag>`
- mark completion: `fugit --repo-root . task done --task-id <task_id> --agent <agent_id>`

## Performance Policy

Default policy is tiny footprint.
- Use default commands first.
- Only opt into burst when speed is needed for short windows.

Burst controls:
- Local scan speed: `fugit --repo-root . status --burst`
- Checkpoint speed: `fugit --repo-root . checkpoint --summary "..." --burst`
- Explicit local parallelism: `--hash-jobs <n>` and `--object-jobs <n>`
- Push parallelism: `fugit --repo-root . bridge sync-github --remote origin --branch <branch> --burst-push` or `--pack-threads <n>`

For profile detail, read:
- `references/workflow-profiles.md`

## MCP Usage

Expose these tools to agents via MCP:
- `fugit_status`
- `fugit_checkpoint`
- `fugit_log`
- `fugit_checkout`
- `fugit_lock_add`
- `fugit_lock_list`
- `fugit_task_add`
- `fugit_task_import`
- `fugit_task_list`
- `fugit_task_request`
- `fugit_task_claim`
- `fugit_task_done`
- `fugit_task_release`
- `fugit_task_gui_launch`
- `fugit_project_list`
- `fugit_project_add`
- `fugit_project_use`
- `fugit_project_remove`
- `fugit_gc`
- `fugit_skill_bundle`
- `fugit_skill_install_codex`

Onboarding a new agent through MCP:
1. Call `fugit_skill_bundle`.
2. Read `skill_md` and reference docs from the response.
3. If needed on host, call `fugit_skill_install_codex`.

## CLI Skill Distribution

Expose the same package through CLI:
- `fugit skill show`
- `fugit skill show --json --include-openai-yaml`
- `fugit skill install-codex`
- `fugit skill doctor`

## Recovery Playbooks

For fast incident handling, read:
- `references/recovery-playbooks.md`

## Guardrails

- Keep timeline checkpoints as the source of progress narration.
- Use `task request` before starting new implementation work when queue-based coordination is active.
- Mark tasks as `done` or `release` them immediately when context switches.
- For multi-repo sessions, register each repo and launch GUI with explicit `--project` when needed.
- Avoid direct Git flow for normal daily operations when fugit is available.
- Use `--ignore-locks` only with explicit authorization.
- Keep `fugit_cloud` gated until Octopus launch interfaces are ready.

## Failover

If fugit is unavailable, use Git as temporary fallback only, then return to fugit workflow.
