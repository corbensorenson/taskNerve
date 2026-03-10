# Workflow Profiles

## Tiny Footprint (Default)

Use when local resource usage should stay minimal.

- `tasknerve --repo-root . status --limit 20`
- `tasknerve --repo-root . checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch>`

Characteristics:
- single-worker local scan/object operations,
- lowest background load,
- GitHub remotes default to GitHub CI verification, while local check registration stays opt-in for non-GitHub/local remotes,
- GitHub issue intake stays available for manual sync or low-task replenishment on GitHub-backed repos,
- best default for laptops/shared dev boxes.

## Persistent Task Queue (Multi-Agent)

Use when multiple agents should coordinate by pulling from a shared queue.

- `tasknerve --repo-root . task import --file /path/to/tasks.tsv`
- `tasknerve --repo-root . task list --ready-only`
- `tasknerve version --json`
- `tasknerve skill doctor --json`
- `tasknerve update check --json`
- `tasknerve --repo-root . task search --status open --contains compiler --jsonl --fields task_id,title,priority,tags`
- `tasknerve --repo-root . task view save --name compiler-open --status open --tag semantic --title-contains compiler --ready-only --limit 25`
- `tasknerve --repo-root . task list --view compiler-open`
- `tasknerve --repo-root . task list --format table --limit 10`
- `tasknerve --repo-root . task start --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- `tasknerve task start --repo-root . --agent <agent_id> --json`
- `tasknerve --repo-root . task start --agent <agent_id> --view compiler-open --json`
- `tasknerve --repo-root . task request --agent <agent_id> --focus compiler --claim-ttl-minutes 30 --steal-after-minutes 90`
- `tasknerve --repo-root . task request --agent <agent_id> --title-contains "compiler" --json`
- `tasknerve --repo-root . task request --agent <agent_id> --view compiler-open --json`
- `tasknerve --repo-root . task request --agent <agent_id> --task-id <task_id> --json`
- `tasknerve --repo-root . task request --agent <agent_id> --max-new-claims 1 --json`
- `tasknerve --repo-root . task request --agent <agent_id> --peek-open 3 --include-context --json`
- `tasknerve --repo-root . task edit --task-id <task_id> --title "Updated X"`
- `tasknerve --repo-root . task show <task_id>`
- `tasknerve --repo-root . task list --jsonl --fields task_id,title,status`
- `tasknerve --repo-root . task list --tag semantic --title-contains "compiler" --json`
- `tasknerve --repo-root . task view list --json`
- `tasknerve --repo-root . task list --agent <agent_id> --mine --json`
- `tasknerve --repo-root . task status --agent <agent_id> --json`
- `tasknerve --repo-root . status --json --summary-only`
- `tasknerve --repo-root . task request --agent <agent_id> --no-claim --max 3 --json`
- `tasknerve --repo-root . task sync-comments --json`
- `tasknerve --repo-root . task sync-comments --marker TODO --marker FIXME --dry-run --json`
- `task request --json` returns `selection_reason`, `claim_ttl_remaining_seconds`, optional `peek_open`, and plan-derived `context` for agent-side branching.
- `tasknerve --repo-root . task policy show --json`
- `tasknerve --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- `tasknerve --repo-root . bridge auto-sync show --json`
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --summary "done summary"`
- `tasknerve --repo-root . task advance --task-id <task_id> --agent <agent_id> --summary "done summary"`
- `tasknerve --repo-root . task progress <task_id> --agent <agent_id> --note "implemented parser wiring"`
- `tasknerve --repo-root . task note <task_id> --agent <agent_id> --message "captured handoff notes" --artifact artifacts/report.json`
- `tasknerve --repo-root . task heartbeat <task_id> --agent <agent_id> --claim-ttl-minutes 60 --note "reran flaky benchmark"`
- `tasknerve --repo-root . task claim <task_id> --agent <agent_id> --extend-only --claim-ttl-minutes 60`
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --claim-next`
- `tasknerve --repo-root . task done --task-id <task_id> --agent <agent_id> --state blocked --reason "waiting on upstream API" --claim-next`
- `tasknerve --repo-root . task release --task-id <task_id> --agent <agent_id> --state blocked --reason "handoff blocked on schema"`
- `tasknerve --repo-root . task cancel --task-id <task_id> --agent <agent_id> --reason "superseded"`
- `tasknerve --repo-root . check run --json`
- `tasknerve --repo-root . check deprecate --check-id <check_id> --reason "obsolete"`

Characteristics:
- dependency-aware ordering via `--depends-on`,
- one-command CLI/skill drift detection via `skill doctor --json`,
- machine-readable binary identity and PATH candidate inspection via `version --json`,
- built-in updater visibility via `update check --json`, with approval-gated `update apply` unless auto-apply is enabled,
- one-command resume-or-claim flow via `task start`,
- one-command complete-and-continue flow via `task advance`,
- reusable saved queue slices via `task view save|list|show|remove`,
- lease-based claims with default stale-claim work stealing,
- default-on date-gate filtering for tasks with `not_before:` tags or date windows in their text,
- default-on auto-replenish scout tasks when no real work is dispatchable,
- optional confirmation gate before scout tasks can start,
- default-on background bridge sync after task completion,
- default-on GitHub CI verification on GitHub remotes, with deterministic CI-failure tasks,
- default-on low-task GitHub issue monitoring with deterministic issue-to-task sync and reviewer follow-up when configured,
- deterministic code-comment backlog harvesting via `task sync-comments`,
- local/non-GitHub repos keep the registered regression/benchmark gate,
- explicit release path for fast agent handoff,
- easy plan maintenance through `task edit` / `task remove`.
- native backlog search via `task list|search --tag/--focus/--contains/--title-contains`.
- explicit unblock path through `task update --clear-blocked`.

## Live Task Board

Use when humans or lead agents need continuous visual awareness of queue state.

- `tasknerve --repo-root . task gui`
- `tasknerve --repo-root . task gui --background --port 0`
- `tasknerve --repo-root . task gui --project <project_name>`
- `tasknerve project discover --json`
- `tasknerve-gui`
- MCP: `tasknerve_task_gui_launch`

Characteristics:
- project switcher plus branch-aware timeline explorer,
- direct create/edit/remove/approve task controls in the browser,
- advisor workflow visibility plus per-run detail/rerun controls in the browser,
- useful when humans need to fix queue drift without dropping to shell.

## Repo-Owned Advisor Workflow

Use when advisor behavior should be versioned with the repository instead of living only in local runtime state.

- `tasknerve --repo-root . advisor workflow init`
- `tasknerve --repo-root . advisor workflow show --json`
- `tasknerve --repo-root . advisor workflow sync-policy --json`
- `tasknerve --repo-root . advisor run show --run-id <run_id> --json`
- `tasknerve --repo-root . advisor run rerun --run-id <run_id> --background --json`

Characteristics:
- stores reviewer/task-manager goals and guidance in `TASKNERVE_WORKFLOW.md`,
- keeps advisor prompting repo-owned and auditable,
- makes prior advisor runs easy to inspect and replay.

## Multi-Project Coordination

Use when multiple repos are active concurrently and agent assignments must stay separated.

- `tasknerve project add --name <project_name> --repo-root <abs_repo_path> --set-default`
- `tasknerve project list`
- `tasknerve project use --name <project_name>`

Characteristics:
- explicit registry of project name -> repo root mappings,
- GUI project switching without mixing task queues,
- safer agent orchestration when several repos are active in parallel.

## Burst Local Compute

Use for short, explicit speed windows on large trees.

- `tasknerve --repo-root . status --burst`
- `tasknerve --repo-root . checkpoint --summary "..." --burst`
- `tasknerve --repo-root . checkpoint --summary "..." --hash-jobs 8 --object-jobs 8`

Characteristics:
- uses available cores (or explicit job counts),
- faster hashing/object writes,
- returns to tiny mode once command finishes.

## Burst Push

Use for short high-throughput bridge pushes.

- `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch> --burst-push`
- `tasknerve --repo-root . bridge sync-github --remote origin --branch <branch> --pack-threads 8`

Characteristics:
- temporary push-time pack threading,
- no persistent high-load daemon.

## Pull With Local Changes

Use when local modifications exist and pull is needed.

- `tasknerve --repo-root . bridge pull-github --remote origin --branch <branch> --autostash`

Characteristics:
- wraps stash/pull/pop flow,
- preserves local changes unless stash pop conflicts.

## Recoverability Repair

Use when doctor reports missing timeline blobs or checkpoint recoverability is blocked.

- `tasknerve --repo-root . doctor --fix`
- `tasknerve --repo-root . checkpoint --summary "..." --repair auto`
- `tasknerve --repo-root . checkpoint --summary "..." --repair-missing-blobs`
- `tasknerve --repo-root . checkpoint --summary "..." --allow-baseline-reseed`
- `tasknerve --repo-root . checkpoint --summary "..." --repair lossy`
- `tasknerve --repo-root . checkpoint --summary "..." --preflight --json`

Characteristics:
- `doctor --fix` performs safe Git-backed object-store rehydration when possible,
- `checkpoint --repair auto`, `--repair-missing-blobs`, and `--allow-baseline-reseed` heal recoverable blobs inline and still fail closed if anything remains missing,
- `checkpoint --repair lossy` reseals head state only when historical blobs are irrecoverable.
