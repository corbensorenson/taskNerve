# Changelog

## Unreleased

- Renamed package to `fugit-alpha` (CLI command remains `fugit`).
- Added cross-platform installers: macOS, Linux, Windows.
- Added shared Unix installer engine with optional skill install.
- Added skill distribution via CLI and MCP tools.
- Added bridge auth wrappers and sync auth preflight.
- Added pull autostash flow.
- Added burst performance controls for local and push paths.
- Added persistent multi-agent task queue with dependency-aware ordering, validated dependencies, edit/remove operations, and work stealing (`task add|edit|remove|import|list|request|claim|done|release` + MCP tools).
- Added live task-board GUI with CLI launch (`task gui`), browser-side create/edit/remove controls, and MCP launch tool (`fugit_task_gui_launch`).
- Added `task show`, request focus filters, richer completion metadata on `task done`, and `--version` for faster agent-side capability detection.
- Added compact queue inspection with `task list --jsonl --fields ...` and preview scheduling with `task request --no-claim --max N --json`.
- Added explicit recoverability repair UX: `doctor --fix` and `checkpoint --repair auto|strict|lossy`.
- Added structured checkpoint payloads via `checkpoint --json`, including machine-readable `missing_blobs[]` on recoverability failures.
- Added plan reconciliation with `task sync --plan ...` and manual reopening via `task reopen`.
- Added `task current`, `in_progress` as a status alias for `claimed`, and `bridge sync-github --repair-journal` for lossy recovery from malformed event journal lines.
- Added `task request --skip-owned` so agents can pull the next ready task without re-dispatching their current claim.
- Added default-on task auto-replenish fallback: when no real work is dispatchable, `task request` seeds per-agent scout tasks, with `task policy show|set`, `task approve`, GUI approval controls, and MCP tools for operating the flow.
- Added default-on background bridge auto-sync after `task done`, with task-note commit subjects, `bridge auto-sync show|set`, and manual detached `bridge sync-github --background`.
- Added project discovery with recent-activity ordering, `task gui --background --port 0`, and an installed `fugit-gui` desktop launcher (`~/Applications/Fugit GUI.app` on macOS, `.desktop` entry on Linux).
- Improved the Unix installer to print the installed version and warn when `PATH` still resolves to a different `fugit` binary.
- Added multi-project registry (`project add|list|use|remove`) and GUI project switching to keep task streams isolated across repos.
- Hardened release validation script to run dependency advisory checks with `cargo-audit` when available.
- Removed project-specific identifiers from README examples to keep docs fingerprint-neutral.
- Integrated task lifecycle operations with timeline events (`task add|edit|claim|done|release|remove`).
- Extended task GUI with a per-project timeline explorer (branch selection + paged scrollable history).
- Added vigorous end-to-end validation script (`scripts/vigorous-e2e.sh`) covering CLI, GUI API, bridge, and MCP flows.
- Expanded README to turnkey setup paths (agent-assisted + manual), Git-to-fugit migration, and Codex/Claude integration guidance.
- Added governance document clarifying maintainer-led upstream control while preserving MIT fork/contribution rights.
