# fugit-alpha

`fugit-alpha` is the package name. The installed CLI is `fugit`.

`fugit` is an agent-first, timeline-first versioning system. It tracks progress continuously, coordinates multi-agent work with a persistent task queue, includes a live Task + Timeline GUI, and uses Git/GitHub as a bridge for publishing.

This started as an internal tool and was made public after Git became a production bottleneck in multi-agent workflows.

## Turnkey Setup (Recommended)

You can point an agent at this repository and have it do the full setup.

### Codex prompt

```text
Set up fugit-alpha on this machine from this repo end-to-end.
- Run the installer for this OS
- Verify fugit works
- Install/update the fugit Codex skill
- Register my current project in fugit
- Initialize timeline and create a baseline checkpoint
- Launch the fugit task/timeline GUI
- Show me the exact commands you ran
```

### Claude prompt

```text
Set up fugit-alpha from this repo end-to-end.
- Run OS installer
- Verify CLI
- Configure fugit MCP server for this project
- Load/apply the bundled fugit skill guidance
- Register project, initialize timeline, create baseline checkpoint
- Launch the fugit task/timeline GUI
- Report exact commands and final status
```

## Manual Setup

### 1. Clone

```bash
git clone <this-repo-url>
cd fugit
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
- PATH is updated automatically in startup files by default.
- Use `--no-path-update` to skip automatic PATH edits.

### 3. Verify

```bash
fugit --version
fugit --help
fugit task --help
fugit skill doctor
```

`fugit task --help` should include `sync` and `reopen`. If not, reinstall using the installer for this repo and run `hash -r` or open a new shell if the old binary is still cached.

### 4. Agent Skill Setup

Codex local install:

```bash
fugit skill install-codex --overwrite
```

Shared skill publish (multi-user machine):

```bash
bash ./scripts/publish-shared-skill.sh --overwrite
```

Claude-compatible setup options:
- MCP-first: run `fugit --repo-root <project_path> mcp serve` and connect your Claude agent tooling to this MCP server.
- Instruction-first: provide `skills/fugit/SKILL.md` (and references) to your Claude workflow as project instructions.

The same bundled skill package is distributed by:
- CLI: `fugit skill show --json --include-openai-yaml`
- MCP tool: `fugit_skill_bundle`

## Convert Existing Git Project to Fugit

```bash
fugit --repo-root <project_path> init --branch trunk
fugit --repo-root <project_path> status --json
fugit project add --name <project_name> --repo-root <project_path> --set-default
fugit --repo-root <project_path> checkpoint \
  --summary "fugit migration baseline" \
  --agent <agent_id> \
  --tag migration
```

After migration, use fugit for daily coordination (`task`, `checkpoint`, `log`), and use bridge commands for GitHub sync/pull.

## Daily Workflow

```bash
fugit --repo-root . task import --file /path/to/tasks.tsv
fugit --repo-root . task sync --plan /path/to/the_final_plan.md
fugit --repo-root . task request --agent agent.worker --focus compiler
fugit --repo-root . task request --agent agent.worker --task-id <task_id>
fugit --repo-root . checkpoint --summary "implemented feature X" --agent agent.worker --tag feature
fugit --repo-root . task done --task-id <task_id> --agent agent.worker --summary "validated feature X" --command "cargo test" --regression "cargo test"
fugit --repo-root . log --limit 20
```

When you are only adding one task, use:

```bash
fugit --repo-root . task add --title "Implement feature X" --priority 10 --tag feature
```

Task lifecycle operations (`add`, `edit`, `claim`, `done`, `reopen`, `release`, `remove`) are mirrored into timeline events.

By default, `task request` also auto-seeds one queue-scout task per known agent when no real work is dispatchable. Use `task policy` to turn this off or require explicit approval before those scout tasks can be claimed.

By default, `task done` requires at least one regression or benchmark check (`--regression ...` / `--benchmark ...`) unless the task already has an active registered check. Those checks are then executed automatically before `bridge sync-github`, including background auto-sync after task completion. Use `fugit check deprecate --check-id ...` when a test is obsolete instead of silently deleting the record.

By default, low-task requests can also queue advisor runs in the background. The advisor can use different providers/models for the reviewer and smart task-manager roles, then sync generated backlog through managed plan files instead of mutating the queue ad hoc.

## Advisor Automation

Provider setup:

```bash
fugit --repo-root . advisor provider discover --json
fugit --repo-root . advisor provider add-codex --assign-role task-manager
fugit --repo-root . advisor provider add-claude --assign-role reviewer
fugit --repo-root . advisor provider add-ollama --model qwen3.5-coder:latest
fugit --repo-root . advisor provider assign --role task-manager --provider <provider_id> --model qwen3.5-coder:latest
fugit --repo-root . advisor provider assign --role reviewer --provider <provider_id> --model sonnet
```

Manual runs:

```bash
fugit --repo-root . advisor show --json
fugit --repo-root . advisor policy set --low-task-threshold 2 --require-confirmation true
fugit --repo-root . advisor review --goal "find the highest-leverage issues" --json
fugit --repo-root . advisor research --goal "generate the next backlog slice" --allow-online-research --json
fugit --repo-root . advisor runs --json
```

Notes:
- `advisor research` imports generated tasks through managed TSV plans under `.fugit/advisor/` so dedupe and promotion stay deterministic.
- `task request` will queue background advisor review/research automatically when standard work falls below the configured threshold.
- The task GUI now includes advisor controls for provider selection, policy, and manual review/research triggers.
- Custom provider wrappers are supported through `advisor provider add-command`; command args can use placeholders such as `{role}`, `{model}`, `{goal}`, `{repo_root}`, and `{prompt}`.

## Privacy

- Fugit keeps advisor runtime state, provider outputs, generated plans, and worker status under `.fugit/`, which is ignored by Git by default.
- Fugit does not write API keys or provider credentials into tracked project files.
- Bridge auth uses Git credential helpers; prefer secure helpers over plaintext storage for long-term use.

## Bulk Task Import

Use this when migrating large plan backlogs into fugit without fragile shell glue.

```bash
fugit --repo-root . task import --file /path/to/tasks.tsv
```

Direct import from markdown checklist plans:

```bash
fugit --repo-root . task import --file /path/to/the_final_plan.md --format markdown
```

Reconcile a living plan file with the queue:

```bash
fugit --repo-root . task sync --plan /path/to/the_final_plan.md --json
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

## Task + Timeline GUI

```bash
fugit --repo-root . task gui
# or
fugit --repo-root . task gui --background --port 0
# or use the installed launcher
fugit-gui
fugit-gui --project <project_name>
```

GUI features:
- Project switcher with most-recent project selection by default
- Optional agent-id field for task mutations
- Task board with create, edit, remove, and approval controls for confirmation-gated scout tasks
- Advisor panel for provider/model selection, low-task policy, and manual review/research triggers
- Timeline explorer (branch selector + paged `load older`)
- Scrollable history to correlate task completion with timeline events
- `project discover` scans common roots for `.fugit/config.json` repos so the launcher can populate the board automatically

Launcher notes:
- `fugit-gui` runs project discovery, starts the board in the background, auto-picks a free port, and opens the most recently worked-on project.
- The Unix installer also creates a desktop launcher: `~/Applications/Fugit GUI.app` on macOS or `~/.local/share/applications/fugit-gui.desktop` on Linux.

Task maintenance from CLI:

```bash
fugit project discover --json
fugit --repo-root . task show --task-id <task_id>
fugit --repo-root . task current --agent <agent_id> --json
fugit --repo-root . task list --jsonl --fields task_id,title,status
fugit --repo-root . task list --status in_progress --json
fugit --repo-root . task edit --task-id <task_id> --title "Updated title" --tag compiler
fugit --repo-root . task remove --task-id <task_id>
fugit --repo-root . task approve --all-pending-auto-replenish --agent reviewer
fugit --repo-root . task policy show --json
fugit --repo-root . task policy set --auto-replenish-confirmation true --replenish-agent agent.alpha --replenish-agent agent.beta --agent reviewer
fugit --repo-root . check add --kind regression --task-id <task_id> --command "cargo test"
fugit --repo-root . check run --json
fugit --repo-root . check deprecate --check-id <check_id> --reason "obsolete"
fugit --repo-root . check policy show --json
fugit --repo-root . advisor show --json
fugit --repo-root . advisor policy show --json
fugit --repo-root . advisor review --background
fugit --repo-root . advisor research --background
fugit --repo-root . bridge auto-sync show --json
fugit --repo-root . bridge auto-sync set --enabled true --on-task-done true --event-count 12
fugit --repo-root . bridge sync-github --background --note "manual backup sweep"
fugit --repo-root . task sync --plan the_final_plan.md --json
fugit --repo-root . task request --agent agent.worker --no-claim --max 3 --json
fugit --repo-root . task request --agent agent.worker --skip-owned --json
fugit --repo-root . task request --agent agent.worker --task-id <task_id> --json
fugit --repo-root . task reopen --task-id <task_id>
```

Recoverability repair:

```bash
fugit --repo-root . doctor --fix
fugit --repo-root . checkpoint --summary "..." --repair auto
fugit --repo-root . checkpoint --summary "..." --repair lossy
fugit --repo-root . checkpoint --summary "..." --json
fugit --repo-root . bridge sync-github --no-push --repair-journal
```

## Core Commands

- `fugit init --branch trunk`
- `fugit status`
- `fugit checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `fugit log --limit 20`
- `fugit checkout --event <event_id> --force`
- `fugit branch list|create|switch`
- `fugit lock add|list|remove`
- `fugit check add|list|run|deprecate|policy`
- `fugit task add|show|current|edit|remove|approve|policy|sync|import|list|request|claim|done|reopen|release|gui`
- `fugit project add|list|use|remove`
- `fugit backend show|set`
- `fugit bridge summary|auth|auto-sync|sync-github|pull-github`
- `fugit gc --dry-run --json`
- `fugit mcp serve`

## MCP Tools

Key tools include:
- `fugit_status`, `fugit_checkpoint`, `fugit_log`, `fugit_checkout`
- `fugit_lock_add`, `fugit_lock_list`
- `fugit_task_show`, `fugit_task_current`, `fugit_task_add`, `fugit_task_edit`, `fugit_task_remove`, `fugit_task_approve`, `fugit_task_policy_show`, `fugit_task_policy_set`, `fugit_task_sync`, `fugit_task_list`, `fugit_task_request`, `fugit_task_claim`, `fugit_task_done`, `fugit_task_reopen`, `fugit_task_release`, `fugit_task_gui_launch`
- `fugit_check_list`, `fugit_check_add`, `fugit_check_deprecate`, `fugit_check_run`, `fugit_check_policy_show`, `fugit_check_policy_set`
- `fugit_task_import` (supports file/tsv/markdown payload import)
- `fugit_project_list`, `fugit_project_add`, `fugit_project_use`, `fugit_project_remove`
- `fugit_gc`
- `fugit_skill_bundle`, `fugit_skill_install_codex`

## Git Bridge

```bash
fugit --repo-root . bridge auth status
fugit --repo-root . bridge auth login --token "$FUGIT_GIT_TOKEN" --helper <helper>
fugit --repo-root . bridge sync-github --remote origin --branch <branch>
fugit --repo-root . bridge pull-github --remote origin --branch <branch> --autostash
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
- `fugit_cloud` remains gated for future v2 workflows.
- Default ignored scan roots: `.git`, `.fugit`, `.tmp`, `node_modules`, `target`, `dist`, `build`, `.next`, `.turbo`, `.cache`, `.idea`, `.vscode`.
