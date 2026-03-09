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

0. If the installed CLI and skill may have drifted, verify once instead of probing `--help` repeatedly:
- `fugit --version`
- `fugit version --json`
- `fugit skill doctor --json`
- `fugit update check --json`
- When built from a git checkout, `fugit --version` should include a build fingerprint such as `0.1.0+a5ce333236d7`; that is the fastest way to tell whether two installed binaries are actually the same build.
- If `current_executable_shadowed` is `true` or `unsupported_command_paths` is non-empty, reinstall fugit from the canonical repo and align the local skill with:
- `fugit skill install-codex --overwrite`
- If `update_available` is `true`, tell the user and wait for approval before running:
- `fugit update apply`
- Exception: if `fugit update policy show --json` reports `auto_apply_enabled=true`, it is acceptable to let fugit update itself automatically.

1. Ensure timeline exists:
- `fugit --repo-root . init --branch trunk`

2. Inspect current state:
- `fugit --repo-root . status --limit 20`
- For cheap agent polling without the full changed-file payload:
- `fugit --repo-root . status --json --summary-only`

3. Register projects when coordinating across multiple repos:
- `fugit project add --name <project_name> --repo-root <abs_repo_path> --set-default`
- `fugit project list`

4. Add shared tasks to the persistent queue:
- `fugit --repo-root . task add --title "Implement X" --priority 10 --tag compiler`
- `fugit --repo-root . task list --ready-only`
- For backlog scans, use native queue search/filtering instead of reading `.fugit/tasks.json` directly:
- `fugit --repo-root . task search --status open --contains compiler --jsonl --fields task_id,title,priority,tags`
- `fugit --repo-root . task list --tag semantic --title-contains "compiler" --json`
- For explicit human-readable queue triage, request a stable render mode:
- `fugit --repo-root . task list --format table --limit 10`
- Prefer bulk backlog migration through import first:
- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- For markdown checklist plans, import directly:
- `fugit --repo-root . task import --file /path/to/the_final_plan.md --format markdown`
- For a living plan file, reconcile queue state directly:
- `fugit --repo-root . task sync --plan /path/to/the_final_plan.md --json`
- Edit or remove tasks when plans change:
- `fugit --repo-root . task edit --task-id <task_id> --title "Updated X"`
- `fugit --repo-root . task remove --task-id <task_id>`

5. Start work with one command (resume current claim or request the next ready task):
- `fugit --repo-root . task start --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- `fugit task start --repo-root . --agent <agent_id> --json`
- `task start` resumes the agent's current claim if one exists; otherwise it claims the next best task.
- Use `task request` when you need preview mode (`--no-claim`, `--max`), explicit scheduling diagnostics, or `--skip-owned`.
- `fugit --repo-root . task request --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- Optional routing hints: `--focus <token>`, `--prefix <token>`, `--contains <token>`, `--title-contains <token>`, plus `--tag <tag>`
- When the queue is genuinely exhausted, `task request` will auto-seed per-agent scout tasks by default so agents can replenish backlog instead of stalling.
- When standard work gets low, `task request` can also queue advisor review/task-manager runs in the background so backlog generation does not stall.
- Date gates are respected by default when tasks carry `not_before:` tags or date windows in title/detail text. Use `--ignore-date-gates` only when you intentionally want to bypass that schedule gate.
- To require human approval before those scout tasks run:
- `fugit --repo-root . task policy set --auto-replenish-confirmation true --agent <agent_id>`
- To approve them explicitly:
- `fugit --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- To bypass your currently claimed work and fetch the next ready task:
- `fugit --repo-root . task request --agent <agent_id> --skip-owned --json`
- To inspect the next ready open candidates without extra list/filter loops:
- `fugit --repo-root . task request --agent <agent_id> --peek-open 3 --json`
- To explicitly allow one extra concurrent claim when you already own work:
- `fugit --repo-root . task request --agent <agent_id> --max-new-claims 1 --json`
- To request a specific task after scanning the queue:
- `fugit --repo-root . task request --agent <agent_id> --task-id <task_id> --json`
- `task request --json` also returns `selection_reason` plus `claim_ttl_remaining_seconds` so agents can branch on why a task was or was not selected and renew leases just-in-time.
- Add `--include-context` when you want plan-derived source refs, acceptance criteria, and a next recommended substep in the JSON payload.
- optional dry assignment: `fugit --repo-root . task request --agent <agent_id> --no-claim`

6. Capture progress as checkpoints:
- `fugit --repo-root . checkpoint --summary "<what changed>" --agent <agent_id> --tag <tag>`
- For agent-safe automation or failure handling:
- `fugit --repo-root . checkpoint --summary "<what changed>" --json`

7. Mark tasks done or release claim:
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --summary "<what finished>"`
- Prefer the dedicated close-and-continue command when you are staying in the queue loop:
- `fugit --repo-root . task advance --task-id <task_id> --agent <agent_id> --summary "<what finished>"`
- To leave a lightweight execution breadcrumb without changing task state:
- `fugit --repo-root . task progress <task_id> --agent <agent_id> --note "<what changed>"`
- To attach machine-readable artifact breadcrumbs for handoff/resume:
- `fugit --repo-root . task note <task_id> --agent <agent_id> --artifact <path>`
- `task note` also accepts `--message "<what changed>"` so agents can leave lightweight progress without switching commands.
- To renew a long-running claim and log progress in one round trip:
- `fugit --repo-root . task heartbeat <task_id> --agent <agent_id> --claim-ttl-minutes 60 --note "<what changed>"`
- To close work and pull the next ready item in one round trip:
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --claim-next`
- To block work and move on without faking completion:
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --state blocked --reason "<why blocked>" --claim-next`
- To release a task back to the queue with explicit blocker context:
- `fugit --repo-root . task release --task-id <task_id> --agent <agent_id> --state blocked --reason "<why blocked>"`
- To retire a malformed or superseded task without deleting its history:
- `fugit --repo-root . task cancel --task-id <task_id> --agent <agent_id> --reason "<why canceled>"`
- To renew ownership on a long-running claim without re-claim side effects:
- `fugit --repo-root . task claim <task_id> --agent <agent_id> --extend-only --claim-ttl-minutes 60`
- Default quality gate is on: GitHub-backed repos verify pushed commits through GitHub CI by default, while local/non-GitHub repos keep using registered regression/benchmark checks. Failed GitHub CI runs deterministically create or refresh follow-up tasks without advisor/model help.
- Low-task GitHub repos also run a deterministic issue monitor by default: safe open issues can be imported into the queue under `.fugit:github_issues`, while obviously harmful/non-actionable issues are skipped.
- Register or retire checks explicitly when needed:
- `fugit --repo-root . check add --kind regression --task-id <task_id> --command "<test command>"`
- `fugit --repo-root . check deprecate --check-id <check_id> --reason "<why obsolete>"`
- Inspect or tune check policy with:
- `fugit --repo-root . check policy show --json`
- `fugit --repo-root . check policy set --backend local --require-on-task-done true`
- `fugit --repo-root . check policy set --backend github-ci --github-timeout-minutes 30 --github-auto-task-on-failure true`
- Inspect or tune GitHub issue intake with:
- `fugit --repo-root . bridge issue-monitor show --json`
- `fugit --repo-root . bridge issue-monitor set --enabled true --low-task-threshold 3 --cooldown-minutes 60 --max-issues 25`
- `fugit --repo-root . bridge sync-github-issues --json`
- By default this also queues a background bridge sync so the completed-task note is pushed without blocking the agent on network I/O.
- Inspect that worker with:
- `fugit --repo-root . bridge auto-sync show --json`
- Tune or disable it with:
- `fugit --repo-root . bridge auto-sync set --enabled false`
- Reopen only when work is intentionally back on the queue:
- `fugit --repo-root . task reopen --task-id <task_id> --agent <agent_id>`
- To clear a manual block after the dependency resolves:
- `fugit --repo-root . task update --task-id <task_id> --clear-blocked --agent <agent_id>`
- `fugit --repo-root . task release --task-id <task_id> --agent <agent_id>`
- Note: task lifecycle mutations (`add`, `edit`/`update`, `claim`, `heartbeat`, `done`, `block`, `reopen`, `release`, `cancel`, `remove`) are mirrored into timeline events automatically.

8. Review event history:
- `fugit --repo-root . log --limit 20`
- Inspect one task directly:
- `fugit --repo-root . task show <task_id>`
- Resume or claim work in one step:
- `fugit --repo-root . task start --agent <agent_id> --json`
- Inspect your active claim directly:
- `fugit --repo-root . task current --agent <agent_id> --include-context --json`
- Inspect your queue/ownership summary directly:
- `fugit --repo-root . task status --agent <agent_id> --json`
- For compact queue scans:
- `fugit --repo-root . task list --jsonl --fields task_id,title,status`
- `fugit --repo-root . task search --contains compiler --status open --jsonl --fields task_id,title,priority,tags`
- `fugit --repo-root . task list --status in_progress --json`
- `fugit --repo-root . task list --agent <agent_id> --mine --json`
- Inspect or change auto-replenish policy:
- `fugit --repo-root . task policy show --json`
- `fugit --repo-root . task policy set --auto-replenish-enabled false --agent <agent_id>`
- For preview scheduling without claiming:
- `fugit --repo-root . task request --agent <agent_id> --no-claim --max 3 --json`
- Run the active verification backend manually:
- `fugit --repo-root . check run --json`
- Inspect or run advisor automation:
- `fugit --repo-root . advisor show --json`
- `fugit --repo-root . advisor workflow show --json`
- `fugit --repo-root . advisor workflow sync-policy --json`
- `fugit --repo-root . advisor policy show --json`
- `fugit --repo-root . advisor review --background`
- `fugit --repo-root . advisor research --background`
- `fugit --repo-root . advisor run show --run-id <run_id> --json`
- `fugit --repo-root . advisor run rerun --run-id <run_id> --background --json`
- Low-task GitHub repos will also try the deterministic issue monitor before advisor low-task automation. If a reviewer provider is configured, successful issue syncs queue a reviewer pass automatically.
- Assign distinct models/providers per role:
- `fugit --repo-root . advisor provider assign --role reviewer --provider <provider_id> --model <model>`
- `fugit --repo-root . advisor provider assign --role task-manager --provider <provider_id> --model <model>`
- Add a custom wrapper when using a local runner or another terminal agent:
- `fugit --repo-root . advisor provider add-command --name <name> --executable <cmd> --arg "{role}" --arg "{model}"`
- Version repo-specific advisor instructions in `FUGIT_WORKFLOW.md` and validate them with:
- `fugit --repo-root . advisor workflow validate --json`

9. Coordinate ownership when multiple agents touch overlapping files:
- `fugit --repo-root . lock add --pattern "src/**" --agent <agent_id> --ttl-minutes 30`
- `fugit --repo-root . lock list`

10. Publish through bridge mode (auth managed by fugit):
- `fugit --repo-root . bridge auth status`
- `fugit --repo-root . bridge auth login --token "$FUGIT_GIT_TOKEN" --helper <helper>`
- `fugit --repo-root . bridge sync-github --remote origin --branch <branch>`
- `fugit --repo-root . bridge sync-github --skip-remote-verification`
- Manual detached push is also available:
- `fugit --repo-root . bridge sync-github --background --note "manual backup sweep"`

11. Pull safely when local edits exist:
- `fugit --repo-root . bridge pull-github --remote origin --branch <branch> --autostash`

12. Serve MCP for multi-agent tool access:
- `fugit --repo-root . mcp serve`

Recoverability repair:
- `fugit --repo-root . doctor --fix`
- `fugit --repo-root . checkpoint --summary "..." --repair auto`
- `fugit --repo-root . checkpoint --summary "..." --repair-missing-blobs`
- `fugit --repo-root . checkpoint --summary "..." --allow-baseline-reseed`
- `fugit --repo-root . checkpoint --summary "..." --repair lossy`
- `fugit --repo-root . checkpoint --summary "..." --preflight --json`
- For malformed event journals during bridge export:
- `fugit --repo-root . bridge sync-github --no-push --repair-journal`

13. Optional live task board window:
- CLI foreground: `fugit --repo-root . task gui`
- CLI background: `fugit --repo-root . task gui --background --port 0`
- Project-pinned GUI: `fugit --repo-root . task gui --project <project_name>`
- Auto-discover projects for the board: `fugit project discover --json`
- Desktop-friendly launcher after install: `fugit-gui`
- Built-in board supports create/edit/remove directly from the browser.
- Confirmation-gated scout tasks can also be approved directly from the browser.
- The board also exposes advisor provider/model selection, low-task policy toggles, workflow visibility, manual review/research triggers, run-detail inspection, and rerun controls.
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
- `fugit --repo-root . task start --agent <agent_id> --json`

2. If no task is returned, first check whether auto-replenish is waiting for approval:
- `fugit --repo-root . task policy show --json`
- `fugit --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- Also inspect advisor low-task policy if the backlog is thin:
- `fugit --repo-root . advisor policy show --json`
- `fugit --repo-root . advisor show --json`
- If auto-replenish is disabled or not appropriate, create an explicit task instead of silent work:
- `fugit --repo-root . task add --title "<deliverable>" --priority <n>`
- If a plan changes, update the existing task instead of leaving drift behind:
- `fugit --repo-root . task edit --task-id <task_id> --title "<updated deliverable>"`

3. Use dependencies for ordering rather than comments:
- `fugit --repo-root . task add --title "<child>" --depends-on <task_id>`
- For large imports, define key-based dependencies in TSV and let fugit resolve task IDs:
- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- TSV columns: `key<TAB>priority<TAB>tags_csv<TAB>depends_on_keys_csv<TAB>title<TAB>detail<TAB>agent`
- Markdown checklist ingestion is also supported:
- `fugit --repo-root . task import --file /path/to/the_final_plan.md --format markdown`
- Markdown import consumes unchecked lines (`- [ ]` / `* [ ]`) and ignores checked lines (`[x]`).

4. Keep ownership explicit:
- claim specific work when needed: `fugit --repo-root . task claim <task_id> --agent <agent_id>`
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
- `fugit_advisor_show`
- `fugit_advisor_policy_show`
- `fugit_advisor_policy_set`
- `fugit_advisor_review`
- `fugit_advisor_research`
- `fugit_task_add`
- `fugit_task_show`
- `fugit_task_current`
- `fugit_task_edit`
- `fugit_task_remove`
- `fugit_task_approve`
- `fugit_task_policy_show`
- `fugit_task_policy_set`
- `fugit_task_sync`
- `fugit_task_import`
- `fugit_task_list`
- `fugit_task_request`
- `fugit_task_claim`
- `fugit_task_done`
- `fugit_task_reopen`
- `fugit_task_release`
- `fugit_task_gui_launch`
- `fugit_check_list`
- `fugit_check_add`
- `fugit_check_deprecate`
- `fugit_check_run`
- `fugit_check_policy_show`
- `fugit_check_policy_set`
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
