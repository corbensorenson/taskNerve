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

### 3. Verify

```bash
fugit --help
fugit skill doctor
```

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
fugit --repo-root . task add --title "Implement feature X" --priority 10 --tag feature
fugit --repo-root . task request --agent agent.worker
fugit --repo-root . checkpoint --summary "implemented feature X" --agent agent.worker --tag feature
fugit --repo-root . task done --task-id <task_id> --agent agent.worker
fugit --repo-root . log --limit 20
```

Task lifecycle operations (`add`, `claim`, `done`, `release`) are mirrored into timeline events.

## Bulk Task Import

Use this when migrating large plan backlogs into fugit without fragile shell glue.

```bash
fugit --repo-root . task import --file /path/to/tasks.tsv
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

## Task + Timeline GUI

```bash
fugit --repo-root . task gui
# or
fugit --repo-root . task gui --background --project <project_name>
```

GUI features:
- Project switcher
- Task board
- Timeline explorer (branch selector + paged `load older`)
- Scrollable history to correlate task completion with timeline events

## Core Commands

- `fugit init --branch trunk`
- `fugit status`
- `fugit checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `fugit log --limit 20`
- `fugit checkout --event <event_id> --force`
- `fugit branch list|create|switch`
- `fugit lock add|list|remove`
- `fugit task add|import|list|request|claim|done|release|gui`
- `fugit project add|list|use|remove`
- `fugit backend show|set`
- `fugit bridge summary|auth|sync-github|pull-github`
- `fugit gc --dry-run --json`
- `fugit mcp serve`

## MCP Tools

Key tools include:
- `fugit_status`, `fugit_checkpoint`, `fugit_log`, `fugit_checkout`
- `fugit_lock_add`, `fugit_lock_list`
- `fugit_task_add`, `fugit_task_list`, `fugit_task_request`, `fugit_task_claim`, `fugit_task_done`, `fugit_task_release`, `fugit_task_gui_launch`
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
