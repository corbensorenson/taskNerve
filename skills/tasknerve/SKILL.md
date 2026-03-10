---
name: tasknerve
description: Agent-first timeline versioning workflow. Use when work should be checkpointed continuously, coordinated across multiple agents, and optionally bridged to GitHub with tasknerve-managed auth instead of direct day-to-day Git.
---

# TaskNerve Skill

Use this skill whenever the user wants version control work to be fast, low-friction, and safe for multi-agent collaboration.

## Activation Criteria

Use this skill when any of the following are true:
- The user asks for checkpointing progress with summaries/tags.
- The user asks to coordinate multiple agents in one repo.
- The user asks for timeline history/restore/branch operations.
- The user asks to publish to GitHub through tasknerve bridge mode.
- The user asks for MCP-based agent orchestration of versioning workflows.

## Workflow

0. If the installed CLI and skill may have drifted, verify once instead of probing `--help` repeatedly:
- `tasknerve --version`
- `tasknerve version --json`
- `tasknerve skill doctor --json`
- `tasknerve update check --json`
- If the repo was installed via the Unix installer, opening a new zsh/bash shell should load the shared bootstrap at `~/.config/tasknerve/shell/tasknerve-shell.sh` automatically.
- When built from a git checkout, `tasknerve --version` should include a build fingerprint such as `0.1.0+a5ce333236d7`; that is the fastest way to tell whether two installed binaries are actually the same build.
- If `current_executable_shadowed` is `true` or `unsupported_command_paths` is non-empty, reinstall tasknerve from the canonical repo and align the local skill with:
- `tasknerve skill install-codex --overwrite`
- If `update_available` is `true`, tell the user and wait for approval before running:
- `tasknerve update apply`
- Exception: if `tasknerve update policy show --json` reports `auto_apply_enabled=true`, it is acceptable to let tasknerve update itself automatically.
- If the user wants TaskNerve embedded directly into the Codex desktop app instead of a browser tab, use:
- `tasknerve codex doctor --json`
- `tasknerve codex install --json`
- `tasknerve codex sync --json`
- For GUI-visible Codex continuation queues, use stable Codex thread ids instead of visible chat titles:
- `tasknerve --repo-root . codex thread list --json`
- `tasknerve --repo-root . codex thread bind --agent <agent_id> --thread-id <codex_session_id> --label "<label>"`
- `tasknerve --repo-root . codex inject --agent <agent_id> --continue-task --cycles 5 --background --json`
- In the TaskNerve panel, prefer the project-level flow: choose the project, mark one active Codex thread as the controller, let TaskNerve adopt the active worker threads, and use project-wide heartbeats. Archiving a Codex conversation removes it from the active worker pool.
- This native Codex path is currently macOS-only and intentionally patches the local `Codex.app` bundle, installs TaskNerve LaunchAgents for the panel and patch sync loop, and routes controller/worker prompting through Codex's own authenticated desktop inference path instead of a separate provider login.
- On branch `codex/codex-native`, prefer adding new portable native logic under `/Users/adimus/Documents/taskNerve/codex-native/`. Rust changes on that branch should be limited to compatibility, parity, or removal-enabling migration work until the native cutover is complete.

1. Ensure timeline exists:
- `tasknerve --repo-root . init --branch trunk`

2. Inspect current state:
- `tasknerve --repo-root . status --limit 20`
- For cheap agent polling without the full changed-file payload:
- `tasknerve --repo-root . status --json --summary-only`

3. Register projects when coordinating across multiple repos:
- `tasknerve project add --name <project_name> --repo-root <abs_repo_path> --set-default`
- `tasknerve project list`

4. Add shared tasks to the persistent queue:
- `tasknerve --repo-root . task add --title "Implement X" --priority 10 --tag compiler`
- `tasknerve --repo-root . task add --title "Implement X" --priority 10 --tags-csv compiler,semantic --depends-on-csv task_a,task_b`
- `tasknerve --repo-root . task list --ready-only`
- For multi-row backlog loads, prefer `task import`/`task sync` over shell array loops.
- For backlog scans, use native queue search/filtering instead of reading `.tasknerve/tasks.json` directly:
- `tasknerve --repo-root . task search --status open --contains compiler --jsonl --fields task_id,title,priority,tags`
- `tasknerve --repo-root . task list --tag semantic --title-contains "compiler" --json`
- For repeated queue slices, save a reusable view once and reuse it:
- `tasknerve --repo-root . task view save --name compiler-open --status open --tag semantic --title-contains compiler --ready-only --limit 25`
- `tasknerve --repo-root . task list --view compiler-open`
- For explicit human-readable queue triage, request a stable render mode:
- `tasknerve --repo-root . task list --format table --limit 10`
- Prefer bulk backlog migration through import first:
- `tasknerve --repo-root . task import --file /path/to/tasks.tsv`
- For markdown checklist plans, import directly:
- `tasknerve --repo-root . task import --file /path/to/the_final_plan.md --format markdown`
- For a living plan file, reconcile queue state directly:
- `tasknerve --repo-root . task sync --plan /path/to/the_final_plan.md --json`
- `task sync` preserves claimed tasks by default; only add `--allow-drop-claimed` when you intentionally want plan sync to retire already claimed work.
- If the queue was previously damaged by a raw store merge or manual edits:
- `tasknerve --repo-root . task doctor queue --json`
- `tasknerve --repo-root . task migrate-store --legacy /path/to/legacy/tasks.json --json`
- For deterministic backlog harvesting from source comments before escalating to advisor work:
- `tasknerve --repo-root . task sync-comments --json`
- `tasknerve --repo-root . task sync-comments --marker TODO --marker FIXME --dry-run --json`
- Edit or remove tasks when plans change:
- `tasknerve --repo-root . task edit --task-id <task_id> --title "Updated X"`
- `tasknerve --repo-root . task remove --task-id <task_id>`

5. Start work with one command (resume current claim or request the next ready task):
- `tasknerve --repo-root . task start --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- `tasknerve task start --repo-root . --agent <agent_id> --json`
- `task start` resumes the agent's current claim if one exists; otherwise it claims the next best task.
- Use `task request` when you need preview mode (`--no-claim`, `--max`), explicit scheduling diagnostics, or `--skip-owned`.
- `tasknerve --repo-root . task request --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- Optional routing hints: `--focus <token>`, `--prefix <token>`, `--contains <token>`, `--title-contains <token>`, plus `--tag <tag>`
- Saved views can be reused at dispatch time with `--view <name>`; only the saved query portion is applied to `task request|start`.
- When the queue is genuinely exhausted, `task request` will auto-seed per-agent scout tasks by default so agents can replenish backlog instead of stalling.
- On the native Codex path, when standard work gets low, prefer project-controller prompt injection and worker heartbeats over the legacy advisor API surface.
- Date gates are respected by default when tasks carry `not_before:` tags or date windows in title/detail text. Use `--ignore-date-gates` only when you intentionally want to bypass that schedule gate.
- To require human approval before those scout tasks run:
- `tasknerve --repo-root . task policy set --auto-replenish-confirmation true --agent <agent_id>`
- To approve them explicitly:
- `tasknerve --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- To bypass your currently claimed work and fetch the next ready task:
- `tasknerve --repo-root . task request --agent <agent_id> --skip-owned --json`
- To skip known non-actionable tags directly at dispatch time:
- `tasknerve --repo-root . task request --agent <agent_id> --exclude-tag blocked-external --exclude-tag waiting-on-policy --json`
- To inspect the next ready open candidates without extra list/filter loops:
- `tasknerve --repo-root . task request --agent <agent_id> --peek-open 3 --json`
- To explicitly allow one extra concurrent claim when you already own work:
- `tasknerve --repo-root . task request --agent <agent_id> --max-new-claims 1 --json`
- To request a specific task after scanning the queue:
- `tasknerve --repo-root . task request --agent <agent_id> --task-id <task_id> --json`
- `task request --json` also returns `selection_reason` plus `claim_ttl_remaining_seconds` so agents can branch on why a task was or was not selected and renew leases just-in-time.
- Add `--include-context` when you want plan-derived source refs, acceptance criteria, and a next recommended substep in the JSON payload.
- optional dry assignment: `tasknerve --repo-root . task request --agent <agent_id> --no-claim`

6. Capture progress as checkpoints:
- `tasknerve --repo-root . checkpoint --summary "<what changed>" --agent <agent_id> --tag <tag>`
- For agent-safe automation or failure handling:
- `tasknerve --repo-root . checkpoint --summary "<what changed>" --json`

7. Mark tasks done or release claim:
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --summary "<what finished>"`
- Prefer the dedicated close-and-continue command when you are staying in the queue loop:
- `tasknerve --repo-root . task advance --task-id <task_id> --agent <agent_id> --summary "<what finished>"`
- To leave a lightweight execution breadcrumb without changing task state:
- `tasknerve --repo-root . task progress <task_id> --agent <agent_id> --note "<what changed>"`
- To attach machine-readable artifact breadcrumbs for handoff/resume:
- `tasknerve --repo-root . task note <task_id> --agent <agent_id> --artifact <path>`
- `task note` also accepts `--message "<what changed>"` so agents can leave lightweight progress without switching commands.
- To renew a long-running claim and log progress in one round trip:
- `tasknerve --repo-root . task heartbeat <task_id> --agent <agent_id> --claim-ttl-minutes 60 --note "<what changed>"`
- To close work and pull the next ready item in one round trip:
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --claim-next`
- To preview the active/new quality checks before mutating task state:
- `tasknerve --repo-root . task done --task-id <task_id> --dry-run-checks --json`
- Direct blocked-state command when the work is real but currently stuck:
- `tasknerve --repo-root . task block --task-id <task_id> --agent <agent_id> --reason "<why blocked>" --claim-next`
- To block work and move on without faking completion:
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --state blocked --reason "<why blocked>" --claim-next`
- To release a task back to the queue with explicit blocker context:
- `tasknerve --repo-root . task release --task-id <task_id> --agent <agent_id> --state blocked --reason "<why blocked>"`
- To hand work off cleanly when you are returning control to the user or otherwise pausing:
- `tasknerve --repo-root . task yield --task-id <task_id> --agent <agent_id> --handoff-ready --reason "<why another agent can take over>"`
- If you are specifically paused on user input or reporting back, prefer:
- `tasknerve --repo-root . task yield --task-id <task_id> --agent <agent_id> --waiting-on-user --reason "<what you are waiting for>"`
- `task yield` is an alias of `task release`, but it also marks the task with explicit handoff tags so another agent can find and take it over quickly.
- Do not just leave a long-running claim behind when you are effectively frozen; use `task yield` or `task block`.
- To retire a malformed or superseded task without deleting its history:
- `tasknerve --repo-root . task cancel --task-id <task_id> --agent <agent_id> --reason "<why canceled>"`
- To renew ownership on a long-running claim without re-claim side effects:
- `tasknerve --repo-root . task claim <task_id> --agent <agent_id> --extend-only --claim-ttl-minutes 60`
- Default quality gate is GitHub-first: GitHub-backed repos verify pushed commits through GitHub CI by default, and task completion does not require local check registration unless the repo policy explicitly opts into that. Local/non-GitHub repos can still use registered regression/benchmark checks when needed.
- On local-check repos, `task done|advance --check-timeout-seconds <n>` overrides the per-run local check timeout that background bridge verification will inherit.
- Low-task GitHub repos also run a deterministic issue monitor by default: safe open issues can be imported into the queue under `.tasknerve:github_issues`, while obviously harmful/non-actionable issues are skipped.
- Register or retire checks explicitly when needed:
- `tasknerve --repo-root . check add --kind regression --task-id <task_id> --command "<test command>"`
- `tasknerve --repo-root . check deprecate --check-id <check_id> --reason "<why obsolete>"`
- Inspect or tune check policy with:
- `tasknerve --repo-root . check policy show --json`
- `tasknerve --repo-root . check policy set --backend local --require-on-task-done true`
- `tasknerve --repo-root . check policy set --backend github-ci --github-timeout-minutes 30 --github-auto-task-on-failure true`
- Inspect or tune GitHub issue intake with:
- `tasknerve --repo-root . bridge issue-monitor show --json`
- `tasknerve --repo-root . bridge issue-monitor set --enabled true --low-task-threshold 3 --cooldown-minutes 60 --max-issues 25`
- `tasknerve --repo-root . bridge sync-github-issues --json`
- By default this also queues a background bridge sync so the completed-task note is pushed without blocking the agent on network I/O.
- Inspect that worker with:
- `tasknerve --repo-root . bridge auto-sync show --json`
- Tune or disable it with:
- `tasknerve --repo-root . bridge auto-sync set --enabled false`
- Reopen only when work is intentionally back on the queue:
- `tasknerve --repo-root . task reopen --task-id <task_id> --agent <agent_id>`
- To clear a manual block after the dependency resolves:
- `tasknerve --repo-root . task update --task-id <task_id> --clear-blocked --agent <agent_id>`
- `tasknerve --repo-root . task release --task-id <task_id> --agent <agent_id>`
- Note: task lifecycle mutations (`add`, `edit`/`update`, `claim`, `heartbeat`, `done`, `block`, `reopen`, `release`, `cancel`, `remove`) are mirrored into timeline events automatically.

8. Review event history:
- `tasknerve --repo-root . log --limit 20`
- Inspect one task directly:
- `tasknerve --repo-root . task show <task_id>`
- Include deterministic plan/task context in that lookup when needed:
- `tasknerve --repo-root . task show <task_id> --include-context --json`
- Resume or claim work in one step:
- `tasknerve --repo-root . task start --agent <agent_id> --json`
- Inspect your active claim directly:
- `tasknerve --repo-root . task current --agent <agent_id> --include-context --json`
- When multiple claims exist, `task current --json` prefers a non-stale primary claim and exposes any stale carryover claims under `stale_claims`.
- Inspect your queue/ownership summary directly:
- `tasknerve --repo-root . task status --agent <agent_id> --json`
- For compact queue scans:
- `tasknerve --repo-root . task list --jsonl --fields task_id,title,status`
- `tasknerve --repo-root . task search --contains compiler --status open --jsonl --fields task_id,title,priority,tags`
- `tasknerve --repo-root . task doctor queue --json`
- `tasknerve --repo-root . task doctor runtime --timeout-seconds 5 --json`
- `tasknerve --repo-root . task view list --json`
- `tasknerve --repo-root . task view show --name compiler-open --json`
- `tasknerve --repo-root . task list --status in_progress --json`
- `tasknerve --repo-root . task list --agent <agent_id> --mine --json`
- Inspect or change auto-replenish policy:
- `tasknerve --repo-root . task policy show --json`
- `tasknerve --repo-root . task policy set --auto-replenish-enabled false --agent <agent_id>`
- For preview scheduling without claiming:
- `tasknerve --repo-root . task request --agent <agent_id> --no-claim --max 3 --json`
- To skip a just-released or externally blocked task on the next dispatch:
- `tasknerve --repo-root . task request --agent <agent_id> --exclude-task-id <task_id> --json`
- Run the active verification backend manually:
- `tasknerve --repo-root . check run --json`
- Override the local check timeout for a one-off manual run:
- `tasknerve --repo-root . check run --timeout-seconds 120 --json`
- For the native Codex flow, prefer controller automation over advisor commands:
- `tasknerve --repo-root . codex thread list --json`
- `tasknerve --repo-root . codex thread bind --agent agent.controller --thread-id <codex_session_id> --label "<project>-controller"`
- `tasknerve --repo-root . codex inject --agent agent.controller --continue-task --background --json`
- `tasknerve --repo-root . codex inject --agent <worker_agent_id> --continue-task --background --json`
- Low-task GitHub repos should still try the deterministic issue monitor before any legacy advisor low-task automation.
- Assign distinct models/providers per role:
- `tasknerve --repo-root . advisor provider assign --role reviewer --provider <provider_id> --model <model>`
- `tasknerve --repo-root . advisor provider assign --role task-manager --provider <provider_id> --model <model>`
- Add a custom wrapper when using a local runner or another terminal agent:
- `tasknerve --repo-root . advisor provider add-command --name <name> --executable <cmd> --arg "{role}" --arg "{model}"`
- Version repo-specific advisor instructions in `TASKNERVE_WORKFLOW.md` and validate them with:
- `tasknerve --repo-root . advisor workflow validate --json`
- Treat the repo-root `project_goals.md` as the durable goals contract and `project_manifest.md` as the durable technical contract. TaskNerve auto-seeds both when a project is added/used or selected in the GUI, and advisor prompts/run reports automatically include both files.

9. Coordinate ownership when multiple agents touch overlapping files:
- `tasknerve --repo-root . lock add --pattern "src/**" --agent <agent_id> --ttl-minutes 30`
- `tasknerve --repo-root . lock list`

10. Publish through bridge mode (auth managed by tasknerve):
- `tasknerve --repo-root . bridge auth status`
- `tasknerve --repo-root . bridge auth login --token "$TASKNERVE_GIT_TOKEN" --helper <helper>`
- `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch>`
- `tasknerve --repo-root . bridge sync-github --skip-remote-verification`
- Manual detached push is also available:
- `tasknerve --repo-root . bridge sync-github --background --note "manual backup sweep"`

11. Pull safely when local edits exist:
- `tasknerve --repo-root . bridge pull-github --remote origin --branch <branch> --autostash`

12. Serve MCP for multi-agent tool access:
- `tasknerve --repo-root . mcp serve`

Recoverability repair:
- `tasknerve --repo-root . doctor --fix`
- `tasknerve --repo-root . task doctor queue --json`
- `tasknerve --repo-root . task doctor runtime --timeout-seconds 5 --json`
- `tasknerve --repo-root . task migrate-store --legacy /path/to/legacy/tasks.json --json`
- `tasknerve --repo-root . checkpoint --summary "..." --repair auto`
- `tasknerve --repo-root . checkpoint --summary "..." --repair-missing-blobs`
- `tasknerve --repo-root . checkpoint --summary "..." --allow-baseline-reseed`
- `tasknerve --repo-root . checkpoint --summary "..." --repair lossy`
- `tasknerve --repo-root . checkpoint --summary "..." --preflight --json`
- For malformed event journals during bridge export:
- `tasknerve --repo-root . bridge sync-github --no-push --repair-journal`

13. Optional live task board window:
- CLI foreground: `tasknerve --repo-root . task gui`
- CLI background: `tasknerve --repo-root . task gui --background --port 0`
- Project-pinned GUI: `tasknerve --repo-root . task gui --project <project_name>`
- Auto-discover projects for the board: `tasknerve project discover --json`
- Desktop-friendly launcher after install: `tasknerve-gui`
- Built-in board supports create/edit/remove directly from the browser.
- Confirmation-gated scout tasks can also be approved directly from the browser.
- The board also exposes advisor provider/model selection, low-task policy toggles, workflow visibility, manual review/research triggers, run-detail inspection, and rerun controls.
- The embedded Codex panel also exposes project-level controller and worker controls: discover active non-archived project conversations, bind one controller thread, adopt the active worker threads, then queue manual controller prompts or project-wide task-continuation heartbeats directly into those visible Codex conversations.
- Timeline explorer: use the branch selector and `load older` in the GUI to scroll project history.
- MCP launch tool: `tasknerve_task_gui_launch`

## Git to TaskNerve Migration

Use this when the user has an existing Git project and wants to switch day-to-day coordination to tasknerve.

1. Preconditions:
- Git repository already exists.
- Working tree is clean or intentionally checkpointed.

2. Initialize tasknerve in the existing repo:
- `tasknerve --repo-root <repo_path> init --branch trunk`
- `tasknerve --repo-root <repo_path> status --json`

3. Register project for multi-repo agent sessions:
- `tasknerve project add --name <project_name> --repo-root <repo_path> --set-default`

4. Capture first tasknerve checkpoint baseline:
- `tasknerve --repo-root <repo_path> checkpoint --summary "tasknerve migration baseline" --agent <agent_id> --tag migration`

5. Move active work coordination to task queue:
- `tasknerve --repo-root <repo_path> task add --title "migration follow-up" --priority 10 --tag migration`
- `tasknerve --repo-root <repo_path> task request --agent <agent_id>`

6. Keep Git as bridge, not primary daily interface:
- `tasknerve --repo-root <repo_path> bridge sync-github --remote origin --branch <branch>`
- `tasknerve --repo-root <repo_path> bridge pull-github --remote origin --branch <branch> --autostash`

7. Agent handoff:
- Install/serve this same skill package so other agents follow tasknerve-first flow:
- CLI install: `tasknerve skill install-codex --overwrite`
- MCP distribution: call `tasknerve_skill_bundle`, then apply returned `skill_md` guidance.

## Task System Contract

Use this contract to keep task execution deterministic across agents.

1. Before starting implementation, request work:
- `tasknerve --repo-root . task start --agent <agent_id> --json`

2. If no task is returned, first check whether auto-replenish is waiting for approval:
- `tasknerve --repo-root . task policy show --json`
- `tasknerve --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- Also inspect advisor low-task policy if the backlog is thin:
- `tasknerve --repo-root . advisor policy show --json`
- `tasknerve --repo-root . advisor show --json`
- If auto-replenish is disabled or not appropriate, create an explicit task instead of silent work:
- `tasknerve --repo-root . task add --title "<deliverable>" --priority <n>`
- If a plan changes, update the existing task instead of leaving drift behind:
- `tasknerve --repo-root . task edit --task-id <task_id> --title "<updated deliverable>"`

3. Use dependencies for ordering rather than comments:
- `tasknerve --repo-root . task add --title "<child>" --depends-on <task_id>`
- For command ergonomics, CSV list flags are supported:
- `tasknerve --repo-root . task add --title "<child>" --tags-csv compiler,queue --depends-on-csv <task_id_a>,<task_id_b>`
- `tasknerve --repo-root . task edit --task-id <task_id> --clear-depends-on --depends-on-csv <replacement_dep_id>`
- `task edit` is idempotent for no-op edits, so automation can safely retry clear/update calls.
- For large imports, define key-based dependencies in TSV and let tasknerve resolve task IDs:
- `tasknerve --repo-root . task import --file /path/to/tasks.tsv`
- TSV columns: `key<TAB>priority<TAB>tags_csv<TAB>depends_on_keys_csv<TAB>title<TAB>detail<TAB>agent`
- Markdown checklist ingestion is also supported:
- `tasknerve --repo-root . task import --file /path/to/the_final_plan.md --format markdown`
- Markdown import consumes unchecked lines (`- [ ]` / `* [ ]`) and ignores checked lines (`[x]`).

4. Keep ownership explicit:
- claim specific work when needed: `tasknerve --repo-root . task claim <task_id> --agent <agent_id>`
- release immediately on context switch: `tasknerve --repo-root . task release --task-id <task_id> --agent <agent_id>`
- if you are pausing in a way another agent could take over, yield instead: `tasknerve --repo-root . task yield --task-id <task_id> --agent <agent_id> --handoff-ready --reason "<handoff summary>"`
- if you are waiting on the user, mark it explicitly: `tasknerve --repo-root . task yield --task-id <task_id> --agent <agent_id> --waiting-on-user --reason "<what you need from the user>"`

5. Close the loop:
- checkpoint progress: `tasknerve --repo-root . checkpoint --summary "<change>" --agent <agent_id> --tag <tag>`
- mark completion: `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id>`

## Performance Policy

Default policy is tiny footprint.
- Use default commands first.
- Only opt into burst when speed is needed for short windows.

Burst controls:
- Local scan speed: `tasknerve --repo-root . status --burst`
- Checkpoint speed: `tasknerve --repo-root . checkpoint --summary "..." --burst`
- Explicit local parallelism: `--hash-jobs <n>` and `--object-jobs <n>`
- Push parallelism: `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch> --burst-push` or `--pack-threads <n>`

For profile detail, read:
- `references/workflow-profiles.md`

## MCP Usage

Expose these tools to agents via MCP:
- `tasknerve_status`
- `tasknerve_checkpoint`
- `tasknerve_log`
- `tasknerve_checkout`
- `tasknerve_lock_add`
- `tasknerve_lock_list`
- `tasknerve_advisor_show`
- `tasknerve_advisor_policy_show`
- `tasknerve_advisor_policy_set`
- `tasknerve_advisor_review`
- `tasknerve_advisor_research`
- `tasknerve_task_add`
- `tasknerve_task_show`
- `tasknerve_task_current`
- `tasknerve_task_edit`
- `tasknerve_task_remove`
- `tasknerve_task_approve`
- `tasknerve_task_policy_show`
- `tasknerve_task_policy_set`
- `tasknerve_task_sync`
- `tasknerve_task_import`
- `tasknerve_task_list`
- `tasknerve_task_request`
- `tasknerve_task_claim`
- `tasknerve_task_done`
- `tasknerve_task_reopen`
- `tasknerve_task_release`
- `tasknerve_task_gui_launch`
- `tasknerve_check_list`
- `tasknerve_check_add`
- `tasknerve_check_deprecate`
- `tasknerve_check_run`
- `tasknerve_check_policy_show`
- `tasknerve_check_policy_set`
- `tasknerve_project_list`
- `tasknerve_project_add`
- `tasknerve_project_use`
- `tasknerve_project_remove`
- `tasknerve_gc`
- `tasknerve_skill_bundle`
- `tasknerve_skill_install_codex`

Onboarding a new agent through MCP:
1. Call `tasknerve_skill_bundle`.
2. Read `skill_md` and reference docs from the response.
3. If needed on host, call `tasknerve_skill_install_codex`.

## CLI Skill Distribution

Expose the same package through CLI:
- `tasknerve skill show`
- `tasknerve skill show --json --include-openai-yaml`
- `tasknerve skill install-codex`
- `tasknerve skill doctor`

## Recovery Playbooks

For fast incident handling, read:
- `references/recovery-playbooks.md`

## Guardrails

- Keep timeline checkpoints as the source of progress narration.
- Use `task request` before starting new implementation work when queue-based coordination is active.
- Mark tasks as `done` or `release` them immediately when context switches.
- For multi-repo sessions, register each repo and launch GUI with explicit `--project` when needed.
- Avoid direct Git flow for normal daily operations when tasknerve is available.
- Use `--ignore-locks` only with explicit authorization.
- Keep `tasknerve_cloud` gated until Octopus launch interfaces are ready.

## Failover

If tasknerve is unavailable, use Git as temporary fallback only, then return to tasknerve workflow.
