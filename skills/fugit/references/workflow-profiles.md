# Workflow Profiles

## Tiny Footprint (Default)

Use when local resource usage should stay minimal.

- `fugit --repo-root . status --limit 20`
- `fugit --repo-root . checkpoint --summary "..." --agent <agent_id> --tag <tag>`
- `fugit --repo-root . bridge sync-github --remote origin --branch <branch>`

Characteristics:
- single-worker local scan/object operations,
- lowest background load,
- best default for laptops/shared dev boxes.

## Persistent Task Queue (Multi-Agent)

Use when multiple agents should coordinate by pulling from a shared queue.

- `fugit --repo-root . task import --file /path/to/tasks.tsv`
- `fugit --repo-root . task list --ready-only`
- `fugit --repo-root . task request --agent <agent_id> --focus compiler --claim-ttl-minutes 30 --steal-after-minutes 90`
- `fugit --repo-root . task edit --task-id <task_id> --title "Updated X"`
- `fugit --repo-root . task show --task-id <task_id>`
- `fugit --repo-root . task list --jsonl --fields task_id,title,status`
- `fugit --repo-root . task request --agent <agent_id> --no-claim --max 3 --json`
- `fugit --repo-root . task policy show --json`
- `fugit --repo-root . task approve --all-pending-auto-replenish --agent <agent_id>`
- `fugit --repo-root . bridge auto-sync show --json`
- `fugit --repo-root . task done --task-id <task_id> --agent <agent_id> --summary "done summary"`

Characteristics:
- dependency-aware ordering via `--depends-on`,
- lease-based claims with default stale-claim work stealing,
- default-on auto-replenish scout tasks when no real work is dispatchable,
- optional confirmation gate before scout tasks can start,
- default-on background bridge sync after task completion,
- explicit release path for fast agent handoff,
- easy plan maintenance through `task edit` / `task remove`.

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
- useful when humans need to fix queue drift without dropping to shell.

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
- `fugit --repo-root . checkpoint --summary "..." --repair lossy`

Characteristics:
- `doctor --fix` performs safe Git-backed object-store rehydration when possible,
- `checkpoint --repair auto` heals recoverable blobs inline and still fails closed if anything remains missing,
- `checkpoint --repair lossy` reseals head state only when historical blobs are irrecoverable.
