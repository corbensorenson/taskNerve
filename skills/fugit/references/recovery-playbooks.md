# Recovery Playbooks

## Auth Missing During Push

Symptom:
- `bridge sync-github` fails with missing credentials.

Recovery:
1. `fugit --repo-root . bridge auth status`
2. `fugit --repo-root . bridge auth login --token "$FUGIT_GIT_TOKEN" --helper <helper>`
3. Retry sync.

## Autostash Pop Conflict After Pull

Symptom:
- pull succeeded, but autostash pop failed.

Recovery:
1. Inspect stash list: `git stash list`
2. Reapply manually: `git stash pop`
3. Resolve conflicts and checkpoint.

## Lock Conflict On Checkpoint

Symptom:
- checkpoint blocked by active locks held by another agent.

Recovery:
1. Inspect locks: `fugit --repo-root . lock list`
2. Coordinate ownership handoff.
3. Retry checkpoint (or `--ignore-locks` only when explicitly authorized).

## Missing Objects During Checkout

Symptom:
- checkout reports missing object blobs.

Recovery:
1. Ensure baseline created via `fugit init` before major edits.
2. Recreate missing state by checkpointing current files where possible.
3. Retry checkout.
