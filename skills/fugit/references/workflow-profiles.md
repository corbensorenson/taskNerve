# Workflow Profiles

## Tiny Footprint (Default)

Use when local resource usage should stay minimal.

- `fugit --repo-root . status --limit 20`
- `fugit --repo-root . checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `fugit --repo-root . bridge sync-github --remote origin --branch <branch>`

Characteristics:
- single-worker local scan/object operations,
- lowest background load,
- GitHub remotes default to GitHub CI verification while non-GitHub/local remotes stay on local checks,
- GitHub issue intake stays available for manual sync or low-task replenishment on GitHub-backed repos,
- best default for laptops/shared dev boxes.

## Persistent Task Queue (Multi-Agent)

Use when multiple agents should coordinate by pulling from a shared queue.

- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- `fugit --repo-root . task list --ready-only`
- `fugit skill doctor --json`
- `fugit --repo-root . task search --status open --contains compiler --jsonl --fields task_id,title,priority,tags`
- `fugit --repo-root . task start --agent <agent_id> --claim-ttl-minutes 30 --steal-after-minutes 90`
- `fugit task start --repo-root . --agent <agent_id> --json`
- `fugit --repo-root . task request --agent <agent_id> --focus compiler --claim-ttl-minutes 30 --steal-after-minutes 90`
- `fugit --repo-root . task request --agent <agent_id> --title-contains "compiler" --json`
- `fugit --repo-root . task request --agent <agent_id> --task-id <task_id> --json`
- `fugit --repo-root . task request --agent <agent_id> --max-new-claims 1 --json`
- `fugit --repo-root . task request --agent <agent_id> --peek-open 3 --include-context --json`
- `fugit --repo-root . task edit --task-id <task_id> --title "Updated X"`
- `fugit --repo-root . task show <task_id>`
- `fugit --repo-root . task list --jsonl --fields task_id,title,status`
- `fugit --repo-root . task list --tag semantic --title-contains "compiler" --json`
- `fugit --repo-root . task list --agent <agent_id> --mine --json`
- `fugit --repo-root . task status --agent <agent_id> --json`
- `fugit --repo-root . status --json --summary-only`
- `fugit --repo-root . task request --agent <agent_id> --no-claim --max 3 --json`
- `task request --json` returns `selection_reason`, `claim_ttl_remaining_seconds`, optional `peek_open`, and plan-derived `context` for agent-side branching.
- `fugit --repo-root . task policy show --json`
- `fugit --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- `fugit --repo-root . bridge auto-sync show --json`
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --summary "done summary"`
- `fugit --repo-root . task progress <task_id> --agent <agent_id> --note "implemented parser wiring"`
- `fugit --repo-root . task note <task_id> --agent <agent_id> --message "captured handoff notes" --artifact artifacts/report.json`
- `fugit --repo-root . task heartbeat <task_id> --agent <agent_id> --claim-ttl-minutes 60 --note "reran flaky benchmark"`
- `fugit --repo-root . task claim <task_id> --agent <agent_id> --extend-only --claim-ttl-minutes 60`
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --claim-next`
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --state blocked --reason "waiting on upstream API" --claim-next`
- `fugit --repo-root . task release --task-id <task_id> --agent <agent_id> --state blocked --reason "handoff blocked on schema"`
- `fugit --repo-root . task cancel --task-id <task_id> --agent <agent_id> --reason "superseded"`
- `fugit --repo-root . check run --json`
- `fugit --repo-root . check deprecate --check-id <check_id> --reason "obsolete"`

Characteristics:
- dependency-aware ordering via `--depends-on`,
- one-command CLI/skill drift detection via `skill doctor --json`,
- one-command resume-or-claim flow via `task start`,
- lease-based claims with default stale-claim work stealing,
- default-on date-gate filtering for tasks with `not_before:` tags or date windows in their text,
- default-on auto-replenish scout tasks when no real work is dispatchable,
- optional confirmation gate before scout tasks can start,
- default-on background bridge sync after task completion,
- default-on GitHub CI verification on GitHub remotes, with deterministic CI-failure tasks,
- default-on low-task GitHub issue monitoring with deterministic issue-to-task sync and reviewer follow-up when configured,
- local/non-GitHub repos keep the registered regression/benchmark gate,
- explicit release path for fast agent handoff,
- easy plan maintenance through `task edit` / `task remove`.
- native backlog search via `task list|search --tag/--focus/--contains/--title-contains`.
- explicit unblock path through `task update --clear-blocked`.

## Live Task Board

Use when humans or lead agents need continuous visual awareness of queue state.

- `fugit --repo-root . task gui`
- `fugit --repo-root . task gui --background --port 0`
- `fugit --repo-root . task gui --project <project_name>`
- `fugit project discover --json`
- `fugit-gui`
- MCP: `fugit_task_gui_launch`

Characteristics:
- project switcher plus branch-aware timeline explorer,
- direct create/edit/remove/approve task controls in the browser,
- advisor workflow visibility plus per-run detail/rerun controls in the browser,
- useful when humans need to fix queue drift without dropping to shell.

## Repo-Owned Advisor Workflow

Use when advisor behavior should be versioned with the repository instead of living only in local runtime state.

- `fugit --repo-root . advisor workflow init`
- `fugit --repo-root . advisor workflow show --json`
- `fugit --repo-root . advisor workflow sync-policy --json`
- `fugit --repo-root . advisor run show --run-id <run_id> --json`
- `fugit --repo-root . advisor run rerun --run-id <run_id> --background --json`

Characteristics:
- stores reviewer/task-manager goals and guidance in `FUGIT_WORKFLOW.md`,
- keeps advisor prompting repo-owned and auditable,
- makes prior advisor runs easy to inspect and replay.

## Multi-Project Coordination

Use when multiple repos are active concurrently and agent assignments must stay separated.

- `fugit project add --name <project_name> --repo-root <abs_repo_path> --set-default`
- `fugit project list`
- `fugit project use --name <project_name>`

Characteristics:
- explicit registry of project name -> repo root mappings,
- GUI project switching without mixing task queues,
- safer agent orchestration when several repos are active in parallel.

## Burst Local Compute

Use for short, explicit speed windows on large trees.

- `fugit --repo-root . status --burst`
- `fugit --repo-root . checkpoint --summary "..." --burst`
- `fugit --repo-root . checkpoint --summary "..." --hash-jobs 8 --object-jobs 8`

Characteristics:
- uses available cores (or explicit job counts),
- faster hashing/object writes,
- returns to tiny mode once command finishes.

## Burst Push

Use for short high-throughput bridge pushes.

- `fugit --repo-root . bridge sync-github --remote origin --branch <branch> --burst-push`
- `fugit --repo-root . bridge sync-github --remote origin --branch <branch> --pack-threads 8`

Characteristics:
- temporary push-time pack threading,
- no persistent high-load daemon.

## Pull With Local Changes

Use when local modifications exist and pull is needed.

- `fugit --repo-root . bridge pull-github --remote origin --branch <branch> --autostash`

Characteristics:
- wraps stash/pull/pop flow,
- preserves local changes unless stash pop conflicts.

## Recoverability Repair

Use when doctor reports missing timeline blobs or checkpoint recoverability is blocked.

- `fugit --repo-root . doctor --fix`
- `fugit --repo-root . checkpoint --summary "..." --repair auto`
- `fugit --repo-root . checkpoint --summary "..." --repair-missing-blobs`
- `fugit --repo-root . checkpoint --summary "..." --allow-baseline-reseed`
- `fugit --repo-root . checkpoint --summary "..." --repair lossy`
- `fugit --repo-root . checkpoint --summary "..." --preflight --json`

Characteristics:
- `doctor --fix` performs safe Git-backed object-store rehydration when possible,
- `checkpoint --repair auto`, `--repair-missing-blobs`, and `--allow-baseline-reseed` heal recoverable blobs inline and still fail closed if anything remains missing,
- `checkpoint --repair lossy` reseals head state only when historical blobs are irrecoverable.
