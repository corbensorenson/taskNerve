# TaskNerve

TaskNerve is the project name. The installed CLI is `tasknerve`.

TaskNerve is an agent-first, timeline-first versioning system. It tracks progress continuously, coordinates multi-agent work with a persistent task queue, includes a live Task + Timeline GUI, and uses Git/GitHub as a bridge for publishing.

This started as an internal tool and was made public after Git became a production bottleneck in multi-agent workflows.

## Turnkey Setup (Recommended)

You can point an agent at this repository and have it do the full setup.

### Codex prompt

```text
Set up TaskNerve on this machine from this repo end-to-end.
- Run the installer for this OS
- Verify tasknerve works
- Install/update the tasknerve Codex skill
- Register my current project in tasknerve
- Initialize timeline and create a baseline checkpoint
- Launch the tasknerve task/timeline GUI
- Show me the exact commands you ran
```

### Claude prompt

```text
Set up TaskNerve from this repo end-to-end.
- Run OS installer
- Verify CLI
- Configure tasknerve MCP server for this project
- Load/apply the bundled tasknerve skill guidance
- Register project, initialize timeline, create baseline checkpoint
- Launch the tasknerve task/timeline GUI
- Report exact commands and final status
```

## Manual Setup

### 1. Clone

```bash
git clone <this-repo-url>
cd taskNerve
```

### 2. Install CLI

macOS:

```bash
bash ./install-macos.sh --with-skill --overwrite-skill
```

Linux:

```bash
bash ./install-linux.sh --with-skill --overwrite-skill
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -WithSkill -OverwriteSkill
```

Note: the Windows installer has not yet been runtime-tested on a Windows machine.

Auto Unix installer (macOS/Linux):

```bash
bash ./install.sh --with-skill --overwrite-skill
```

Unix installer behavior:
- a shared shell bootstrap is written to `~/.config/tasknerve/shell/tasknerve-shell.sh` by default,
- login/interactive startup files source that bootstrap automatically across zsh and bash,
- PATH is updated through that bootstrap by default,
- Use `--no-path-update` to skip shell profile edits.

### 3. Verify

```bash
tasknerve --version
tasknerve version --json
tasknerve --help
tasknerve skill doctor
tasknerve skill doctor --json
```

`tasknerve --version` now includes a build fingerprint when tasknerve is built from a git checkout, for example `tasknerve 0.1.0+a5ce333236d7`. That makes it obvious when two installed binaries are not the same build even if the package version has not changed.

`tasknerve version --json` exposes a stable machine-readable envelope with the build fingerprint, git sha, current executable path, and every `tasknerve` binary currently visible on `PATH`.

`tasknerve skill doctor --json` now reports whether the installed Codex skill matches the running CLI, whether the skill references command paths this binary does not support, and whether `PATH` resolves a different `tasknerve` binary than the current executable. If `unsupported_command_paths` is non-empty, `current_executable_shadowed` is `true`, or the installed skill does not match the embedded bundle, reinstall from this repo, run `tasknerve skill install-codex --overwrite`, then `hash -r` or open a new shell if the old binary is still cached.

If your machine has trouble executing script-based launchers directly, opening a new zsh/bash shell after install is enough to pick up the bootstrap and keep `tasknerve` usable through the shell command name.

## Update Workflow

TaskNerve now has a built-in updater with a managed checkout under `TASKNERVE_HOME`.

Check status:

```bash
tasknerve update show --json
tasknerve update check --json
```

Apply an approved update:

```bash
tasknerve update apply --json
```

Tune automatic upkeep:

```bash
tasknerve update policy show --json
tasknerve update policy set --auto-check-enabled true --auto-apply-enabled false --check-interval-hours 24
```

Defaults:
- auto-check is on
- auto-apply is off
- check cadence is 24 hours

That means agents can notice that tasknerve is stale without silently changing the machine. If you want fully unattended upkeep, turn on `--auto-apply-enabled true`.

### 4. Agent Skill Setup

Codex local install:

```bash
tasknerve skill install-codex --overwrite
```

Shared skill publish (multi-user machine):

```bash
bash ./scripts/publish-shared-skill.sh --overwrite
```

Claude-compatible setup options:
- MCP-first: run `tasknerve --repo-root <project_path> mcp serve` and connect your Claude agent tooling to this MCP server.
- Instruction-first: provide `skills/tasknerve/SKILL.md` (and references) to your Claude workflow as project instructions.

The same bundled skill package is distributed by:
- CLI: `tasknerve skill show --json --include-openai-yaml`
- MCP tool: `tasknerve_skill_bundle`

## Convert Existing Git Project to TaskNerve

```bash
tasknerve --repo-root <project_path> init --branch trunk
tasknerve --repo-root <project_path> status --json
tasknerve --repo-root <project_path> status --json --summary-only
tasknerve project add --name <project_name> --repo-root <project_path> --set-default
tasknerve --repo-root <project_path> checkpoint \
  --summary "tasknerve migration baseline" \
  --agent <agent_id> \
  --tag migration
```

After migration, use tasknerve for daily coordination (`task`, `checkpoint`, `log`), and use bridge commands for GitHub sync/pull.

## Daily Workflow

```bash
tasknerve --repo-root . task import --file /path/to/tasks.tsv
tasknerve --repo-root . task sync --plan /path/to/the_final_plan.md
tasknerve --repo-root . task sync --plan /path/to/the_final_plan.md --allow-drop-claimed
tasknerve --repo-root . task view save --name compiler-open --status open --tag semantic --title-contains compiler --ready-only --limit 25
tasknerve --repo-root . task list --view compiler-open
tasknerve --repo-root . task start --agent agent.worker --view compiler-open --peek-open 3 --json
tasknerve --repo-root . task sync-comments --json
tasknerve --repo-root . task doctor queue --json
tasknerve --repo-root . task doctor runtime --timeout-seconds 5 --json
tasknerve --repo-root . task migrate-store --legacy /path/to/legacy/tasks.json --json
tasknerve --repo-root . task search --status open --contains compiler --jsonl --fields task_id,title,priority,tags
tasknerve --repo-root . task list --format table --limit 10
tasknerve --repo-root . task start --agent agent.worker
tasknerve task start --repo-root . --agent agent.worker --focus compiler --peek-open 3 --json
tasknerve --repo-root . task start --agent agent.worker --task-id <task_id>
tasknerve --repo-root . task progress --task-id <task_id> --agent agent.worker --note "landed parser wiring"
tasknerve --repo-root . task note --task-id <task_id> --agent agent.worker --message "captured benchmark delta" --artifact artifacts/report.json
tasknerve --repo-root . checkpoint --summary "implemented feature X" --agent agent.worker --tag feature
tasknerve --repo-root . task done --task-id <task_id> --agent agent.worker --summary "validated feature X" --command "cargo test" --claim-next
tasknerve --repo-root . task advance --task-id <task_id> --agent agent.worker --summary "validated feature X" --command "cargo test"
tasknerve --repo-root . log --limit 20
```

When you are only adding one task, use:

```bash
tasknerve --repo-root . task add --title "Implement feature X" --priority 10 --tag feature
```

`task start` is the normal agent entrypoint: it resumes the agent's current claim if one exists, otherwise it claims the next best task. Use `task request` when you want preview mode (`--no-claim`, `--max`), explicit scheduling diagnostics, or to bypass your current claim with `--skip-owned`.

`task advance` is the tight completion loop: it is equivalent to `task done --claim-next`, but easier for agents to discover from `--help` and easier to standardize in shared skills.

`task list --format table|compact|json|jsonl` gives an explicit render mode so agents do not need to infer output shape from a mix of flags.

For backlog shaping, prefer `task list` / `task search` filters such as `--tag`, `--focus`, `--contains`, and `--title-contains` over reading `.tasknerve/tasks.json` directly.

For repeated queue scans, save those filters as a named view once and reuse them with `task list --view ...`, `task request --view ...`, or `task start --view ...`.

When you want more deterministic backlog without spending model tokens, use `task sync-comments`. It scans supported source files for comment markers like `TODO`, `FIXME`, `BUG`, and `HACK`, then reconciles them into managed tasks under `.tasknerve:code_comments`.

When an agent already owns a claim, `task request` now returns that owned claim without silently shrinking its lease. If the agent explicitly wants an additional claim, use `--max-new-claims 1` (or higher) and branch on `selection_reason` / `claim_ttl_remaining_seconds` from the JSON payload.

For tighter agent loops, `task request --peek-open N` and `task start --peek-open N` return the next ready open candidates alongside the selected task. JSON `task request`, `task start`, `task current`, and `task show` payloads can also include deterministic plan-derived `context` with source refs, acceptance criteria, and a next recommended substep.

Task lifecycle operations (`add`, `edit`, `claim`, `done`, `reopen`, `release`, `remove`) are mirrored into timeline events.

`task sync` now preserves claimed tasks by default even when a living plan file no longer mentions them. Use `--allow-drop-claimed` only when you intentionally want plan reconciliation to retire already claimed work.

If a queue was previously damaged by raw store edits or a legacy store merge, start with `task doctor queue --json`, then rehydrate through `task migrate-store --legacy <tasks.json>` instead of hand-editing `.tasknerve/tasks.json`.

By default, `task request` also auto-seeds one queue-scout task per known agent when no real work is dispatchable. Use `task policy` to turn this off or require explicit approval before those scout tasks can be claimed.

By default, `task request` respects date gates discovered from tags like `not_before:2026-04-21` or from task text like `2026-04-21 through 2026-06-01`. Use `--ignore-date-gates` only when you intentionally want to bypass that scheduling guard.

By default, tasknerve uses GitHub CI verification when the repo's `origin` points at GitHub, and it does not require local check registration just to complete a task. On GitHub-backed repos, `bridge sync-github` waits for the pushed commit's Actions runs, reports the result, and deterministically opens or refreshes CI-failure tasks when verification fails. On non-GitHub or fully local repos, registered regression/benchmark checks stay available through `check add|run|deprecate|policy` as an explicit opt-in.

By default, low-task requests also run a deterministic GitHub issue monitor on GitHub-backed repos. It fetches open issues, filters out obvious spam/non-actionable/harmful requests, syncs safe issues into the backlog under `.tasknerve:github_issues`, and queues a reviewer pass when a reviewer provider is configured.

By default, low-task requests can also queue advisor runs in the background. The advisor can use different providers/models for the reviewer and smart task-manager roles, then sync generated backlog through managed plan files instead of mutating the queue ad hoc.

For agent install hygiene, check `tasknerve update check --json` before spending time debugging CLI drift, and only run `tasknerve update apply` after user approval unless the machine policy already enables auto-apply.

## Advisor Automation

Provider setup:

```bash
tasknerve --repo-root . advisor provider discover --json
tasknerve --repo-root . advisor provider add-codex --assign-role task-manager
tasknerve --repo-root . advisor provider add-claude --assign-role reviewer
tasknerve --repo-root . advisor provider add-ollama --model qwen3.5-coder:latest
tasknerve --repo-root . advisor provider assign --role task-manager --provider <provider_id> --model qwen3.5-coder:latest
tasknerve --repo-root . advisor provider assign --role reviewer --provider <provider_id> --model sonnet
tasknerve --repo-root . bridge issue-monitor show --json
tasknerve --repo-root . bridge issue-monitor set --enabled true --low-task-threshold 3 --cooldown-minutes 60 --max-issues 25
tasknerve --repo-root . bridge sync-github-issues --json
```

Manual runs:

```bash
tasknerve --repo-root . advisor show --json
tasknerve --repo-root . advisor workflow show --json
tasknerve --repo-root . advisor workflow sync-policy --json
tasknerve --repo-root . advisor policy set --low-task-threshold 2 --require-confirmation true
tasknerve --repo-root . advisor review --goal "find the highest-leverage issues" --json
tasknerve --repo-root . advisor research --goal "generate the next backlog slice" --allow-online-research --json
tasknerve --repo-root . advisor runs --json
tasknerve --repo-root . advisor run show --run-id <run_id> --json
tasknerve --repo-root . advisor run rerun --run-id <run_id> --background --json
```

Notes:
- `advisor research` imports generated tasks through managed TSV plans under `.tasknerve/advisor/` so dedupe and promotion stay deterministic.
- `bridge sync-github-issues` imports screened GitHub issues through the managed source `.tasknerve:github_issues`, keeping dedupe deterministic and leaving obvious harmful/non-actionable issues out of the queue.
- `task request` will queue background advisor review/research automatically when standard work falls below the configured threshold.
- `task request` will also try the GitHub issue monitor before advisor low-task automation, so real upstream issues can replenish the queue without waiting on model output.
- The task GUI now includes advisor controls for provider selection, policy, manual review/research triggers, workflow visibility, run detail inspection, and rerun controls.
- Custom provider wrappers are supported through `advisor provider add-command`; command args can use placeholders such as `{role}`, `{model}`, `{goal}`, `{repo_root}`, and `{prompt}`.

## Repo-Owned Advisor Workflow

TaskNerve now supports a repo-owned advisor contract at `TASKNERVE_WORKFLOW.md`.

Bootstrap it:

```bash
tasknerve --repo-root . advisor workflow init
tasknerve --repo-root . advisor workflow validate --json
```

Use it to version:
- reviewer/task-manager default goals
- role-specific guidance
- result-size caps (`max_findings`, `max_tasks`)
- advisor policy defaults that can be synced into runtime state

Sync the policy defaults from the file into the live advisor state:

```bash
tasknerve --repo-root . advisor workflow sync-policy --json
```

The same workflow metadata is exposed in `advisor show --json`, advisor run reports, and the browser GUI so operators can see whether advisor automation is running from repo defaults or fallback prompts.

## Developer Auto-Refresh

If you develop tasknerve itself on a machine and want the installed `tasknerve` binary plus bundled skill to stay fresh automatically as the repo changes, enable the tracked git hooks:

```bash
bash ./scripts/install-dev-hooks.sh
```

That sets `core.hooksPath` to the repo's `githooks/` directory. The hooks run a cheap hash check and then refresh the local install after relevant tasknerve changes on `post-commit`, `post-checkout`, `post-merge`, `post-rewrite`, and `pre-push`.

By default the refresh is best-effort and does not block the triggering git action if the reinstall fails. If you want pushes/checkouts to fail hard when the local install cannot be refreshed, set:

```bash
export TASKNERVE_DEV_AUTO_INSTALL_STRICT=1
```

The auto-refresh script also has a safety timeout so a bad local build does not wedge git hooks forever. Override it when needed with:

```bash
export TASKNERVE_DEV_AUTO_INSTALL_TIMEOUT_SECONDS=300
```

## Privacy

- TaskNerve keeps advisor runtime state, provider outputs, generated plans, and worker status under `.tasknerve/`, which is ignored by Git by default.
- The repo-owned `TASKNERVE_WORKFLOW.md` is intended for prompts and policy defaults only; do not store credentials or raw tokens in it.
- TaskNerve does not write API keys or provider credentials into tracked project files.
- Bridge auth uses Git credential helpers; prefer secure helpers over plaintext storage for long-term use.

## Bulk Task Import

Use this when migrating large plan backlogs into tasknerve without fragile shell glue.

```bash
tasknerve --repo-root . task import --file /path/to/tasks.tsv
```

Direct import from markdown checklist plans:

```bash
tasknerve --repo-root . task import --file /path/to/the_final_plan.md --format markdown
```

Reconcile a living plan file with the queue:

```bash
tasknerve --repo-root . task sync --plan /path/to/the_final_plan.md --json
```

If that reconciliation intentionally needs to retire already claimed work, opt in explicitly:

```bash
tasknerve --repo-root . task sync --plan /path/to/the_final_plan.md --allow-drop-claimed --json
```

TSV format (tab-separated):

`key<TAB>priority<TAB>tags_csv<TAB>depends_on_keys_csv<TAB>title<TAB>detail<TAB>agent`

Example:

```text
ROOT	90	planning,seed		Define root contracts	foundation contract pass	agent.root
CHILD	70	impl	ROOT	Implement dependent work	depends on root	agent.child
```

Notes:
- `depends_on_keys_csv` links by task keys and is resolved to real task IDs automatically.
- Cycles and unknown dependency keys fail closed.
- `detail` and `agent` columns are optional.
- Markdown import consumes unchecked checklist lines (`- [ ] ...` / `* [ ] ...`) and skips completed lines (`[x]`).

## Saved Views and Comment Sync

Reusable task views:

```bash
tasknerve --repo-root . task view save --name compiler-open --status open --tag semantic --title-contains compiler --ready-only --limit 25
tasknerve --repo-root . task view list --json
tasknerve --repo-root . task view show --name compiler-open --json
tasknerve --repo-root . task list --view compiler-open
tasknerve --repo-root . task request --agent agent.worker --view compiler-open --no-claim --json
```

Deterministic code-comment backlog sync:

```bash
tasknerve --repo-root . task sync-comments --json
tasknerve --repo-root . task sync-comments --marker TODO --marker FIXME --dry-run --json
```

Notes:
- Saved views preserve common query and list settings so agents can stop rediscovering the same queue slices.
- `task request|start --view ...` only use the saved query portion of the view, not list-only render settings.
- `task sync-comments` respects `.gitignore` / `.tasknerveignore`, skips oversized or unsupported files, and removes stale managed comment tasks unless `--keep-missing` is set.

## Task + Timeline GUI

```bash
tasknerve --repo-root . task gui
# or
tasknerve --repo-root . task gui --background --port 0
# or use the installed launcher
tasknerve-gui
tasknerve-gui --project <project_name>
```

GUI features:
- Project switcher with most-recent project selection by default
- Optional agent-id field for task mutations
- Task board with create, edit, remove, and approval controls for confirmation-gated scout tasks
- Advisor panel for provider/model selection, low-task policy, workflow visibility, manual review/research triggers, per-run detail inspection, and rerun controls
- Timeline explorer (branch selector + paged `load older`)
- Scrollable history to correlate task completion with timeline events
- `project discover` scans common roots for `.tasknerve/config.json` repos so the launcher can populate the board automatically

Launcher notes:
- `tasknerve-gui` runs project discovery, starts the board in the background, auto-picks a free port, and opens the most recently worked-on project.
- The Unix installer also creates a desktop launcher: `~/Applications/TaskNerve GUI.app` on macOS or `~/.local/share/applications/tasknerve-gui.desktop` on Linux.

Task maintenance from CLI:

```bash
tasknerve project discover --json
tasknerve --repo-root . task show <task_id>
tasknerve --repo-root . task show <task_id> --include-context --json
tasknerve task start --repo-root . --agent <agent_id> --json
tasknerve --repo-root . task start --repo-root . --agent <agent_id> --peek-open 3 --include-context --json
tasknerve --repo-root . task current --agent <agent_id> --include-context --json
tasknerve --repo-root . task status --agent <agent_id> --json
tasknerve --repo-root . task list --agent <agent_id> --mine --json
tasknerve --repo-root . task list --jsonl --fields task_id,title,status
tasknerve --repo-root . task list --status in_progress --json
tasknerve --repo-root . task edit --task-id <task_id> --title "Updated title" --tag compiler
tasknerve --repo-root . task update --task-id <task_id> --clear-blocked --agent <agent_id>
tasknerve --repo-root . task claim <task_id> --agent <agent_id> --extend-only --claim-ttl-minutes 60
tasknerve --repo-root . task heartbeat <task_id> --agent <agent_id> --claim-ttl-minutes 60 --note "reran flaky benchmark"
tasknerve --repo-root . task progress <task_id> --note "waiting on benchmark rerun"
tasknerve --repo-root . task note <task_id> --message "captured handoff notes" --artifact artifacts/report.json --artifact artifacts/trace.log
tasknerve --repo-root . task release <task_id> --agent <agent_id> --state blocked --reason "waiting on upstream API"
tasknerve --repo-root . task cancel <task_id> --agent <agent_id> --reason "superseded by replacement plan"
tasknerve --repo-root . task remove --task-id <task_id>
tasknerve --repo-root . task approve --all-pending-auto-replenish --agent reviewer
tasknerve --repo-root . task policy show --json
tasknerve --repo-root . task policy set --auto-replenish-confirmation true --replenish-agent agent.alpha --replenish-agent agent.beta --agent reviewer
tasknerve --repo-root . check add --kind regression --task-id <task_id> --command "cargo test"
tasknerve --repo-root . check run --json
tasknerve --repo-root . check deprecate --check-id <check_id> --reason "obsolete"
tasknerve --repo-root . check policy show --json
tasknerve --repo-root . check policy set --backend local --require-on-task-done true
tasknerve --repo-root . check policy set --backend github-ci --github-timeout-minutes 30 --github-auto-task-on-failure true
tasknerve --repo-root . advisor show --json
tasknerve --repo-root . advisor policy show --json
tasknerve --repo-root . advisor review --background
tasknerve --repo-root . advisor research --background
tasknerve --repo-root . bridge auto-sync show --json
tasknerve --repo-root . bridge auto-sync set --enabled true --on-task-done true --event-count 12
tasknerve --repo-root . bridge sync-github --background --note "manual backup sweep"
tasknerve --repo-root . task sync --plan the_final_plan.md --json
tasknerve --repo-root . task request --agent agent.worker --no-claim --max 3 --json
tasknerve --repo-root . task request --agent agent.worker --skip-owned --json
tasknerve --repo-root . task request --agent agent.worker --max-new-claims 1 --json
tasknerve --repo-root . task request --agent agent.worker --peek-open 3 --json
tasknerve --repo-root . task request --agent agent.worker --title-contains "compiler" --json
tasknerve --repo-root . task request --agent agent.worker --task-id <task_id> --json
tasknerve --repo-root . task request --agent agent.worker --include-context --json
tasknerve --repo-root . task request --agent agent.worker --json   # includes selection_reason + claim_ttl_remaining_seconds, with peek_open/context when requested
tasknerve --repo-root . status --json --summary-only              # fast health polling without file list
tasknerve --repo-root . task done --task-id <task_id> --claim-next --json
tasknerve --repo-root . task done --task-id <task_id> --state blocked --reason "needs schema decision" --claim-next --json
tasknerve --repo-root . task reopen --task-id <task_id>
```

## CI Verification

- `tasknerve --repo-root . check policy show --json` shows the active verification backend plus GitHub CI timing, failure-task policy, and whether task completion currently requires local check registration.
- `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch>` now returns only after the active backend has verified the pushed commit, unless you explicitly disable that wait.
- `tasknerve --repo-root . bridge sync-github --skip-remote-verification` bypasses the GitHub wait for one sync.
- `tasknerve --repo-root . check run --json` follows the active backend: local registered checks on local repos when enabled, or GitHub CI status for the current `HEAD` commit on GitHub-backed repos.
- Failed GitHub CI runs automatically create or refresh deterministic follow-up tasks under the managed source `.tasknerve:github_ci_failures`, without needing advisor/model involvement.

Recoverability repair:

```bash
tasknerve --repo-root . doctor --fix
tasknerve --repo-root . task doctor queue --json
tasknerve --repo-root . task doctor runtime --timeout-seconds 5 --json
tasknerve --repo-root . task migrate-store --legacy /path/to/legacy/tasks.json --json
tasknerve --repo-root . checkpoint --summary "..." --preflight --json
tasknerve --repo-root . checkpoint --summary "..." --repair auto
tasknerve --repo-root . checkpoint --summary "..." --repair-missing-blobs
tasknerve --repo-root . checkpoint --summary "..." --allow-baseline-reseed
tasknerve --repo-root . checkpoint --summary "..." --repair lossy
tasknerve --repo-root . checkpoint --summary "..." --json
tasknerve --repo-root . bridge sync-github --no-push --repair-journal
```

## Core Commands

- `tasknerve init --branch trunk`
- `tasknerve status`
- `tasknerve checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `tasknerve log --limit 20`
- `tasknerve checkout --event <event_id> --force`
- `tasknerve branch list|create|switch`
- `tasknerve lock add|list|remove`
- `tasknerve check add|list|run|deprecate|policy`
- `tasknerve task add|show|current|edit|update|remove|approve|policy|view|sync|sync-comments|import|list|request|start|advance|claim|heartbeat|progress|note|done|reopen|release|cancel|gui`
- `tasknerve project add|list|use|remove`
- `tasknerve backend show|set`
- `tasknerve bridge summary|auth|auto-sync|sync-github|pull-github`
- `tasknerve gc --dry-run --json`
- `tasknerve mcp serve`

## MCP Tools

Key tools include:
- `tasknerve_status`, `tasknerve_checkpoint`, `tasknerve_log`, `tasknerve_checkout`
- `tasknerve_lock_add`, `tasknerve_lock_list`
- `tasknerve_task_show`, `tasknerve_task_current`, `tasknerve_task_add`, `tasknerve_task_edit`, `tasknerve_task_remove`, `tasknerve_task_approve`, `tasknerve_task_policy_show`, `tasknerve_task_policy_set`, `tasknerve_task_view_list`, `tasknerve_task_view_show`, `tasknerve_task_view_save`, `tasknerve_task_view_remove`, `tasknerve_task_sync`, `tasknerve_task_sync_comments`, `tasknerve_task_list`, `tasknerve_task_request`, `tasknerve_task_start`, `tasknerve_task_advance`, `tasknerve_task_claim`, `tasknerve_task_done`, `tasknerve_task_progress`, `tasknerve_task_note`, `tasknerve_task_reopen`, `tasknerve_task_release`, `tasknerve_task_cancel`, `tasknerve_task_heartbeat`, `tasknerve_task_gui_launch`
- `tasknerve_check_list`, `tasknerve_check_add`, `tasknerve_check_deprecate`, `tasknerve_check_run`, `tasknerve_check_policy_show`, `tasknerve_check_policy_set`
- `tasknerve_task_import` (supports file/tsv/markdown payload import)
- `tasknerve_project_list`, `tasknerve_project_add`, `tasknerve_project_use`, `tasknerve_project_remove`
- `tasknerve_gc`
- `tasknerve_skill_bundle`, `tasknerve_skill_install_codex`

## Git Bridge

```bash
tasknerve --repo-root . bridge auth status
tasknerve --repo-root . bridge auth login --token "$TASKNERVE_GIT_TOKEN" --helper <helper>
tasknerve --repo-root . bridge sync-github --remote origin --branch <branch>
tasknerve --repo-root . bridge pull-github --remote origin --branch <branch> --autostash
```

## Performance

Default mode is tiny-footprint.

Burst controls:
- `--burst`
- `--hash-jobs <n>` / `--object-jobs <n>`
- `bridge sync-github --burst-push` or `--pack-threads <n>`

## Validation and Testing

Release check:

```bash
bash ./scripts/public-release-check.sh
```

Vigorous end-to-end suite:

```bash
bash ./scripts/vigorous-e2e.sh
```

## Licensing and Project Control

License is [MIT](LICENSE): permissive, open source, allows forks and contributions.

Mainline direction/control is maintained through repository governance and maintainer merge/release authority. See [GOVERNANCE.md](GOVERNANCE.md).

## Repository Policy Docs

- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `GOVERNANCE.md`

## Notes

- Default backend mode is `git_bridge`.
- `tasknerve_cloud` remains gated for future v2 workflows.
- Default ignored scan roots: `.git`, `.tasknerve`, `.tmp`, `node_modules`, `target`, `dist`, `build`, `.next`, `.turbo`, `.cache`, `.idea`, `.vscode`.
