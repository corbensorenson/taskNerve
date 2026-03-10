# Project Manifest

Status: draft
Managed by: TaskNerve
Last generated: 2026-03-10T08:19:19Z

This file locks the technical contract for how `project_goals.md` will be achieved. Use it to record approved languages, libraries, software patterns, commands, and engineering constraints.

## Current Technical Snapshot
- Repository: `taskNerve`
- Repo root: `/Users/adimus/Documents/taskNerve`

### Languages and runtimes detected
- Rust

### Toolchains and package managers detected
- Cargo

### Likely frameworks and libraries detected
- anyhow
- chrono
- clap
- globset
- ignore
- rayon
- serde
- serde_json
- serde_yaml
- sha2
- uuid
- walkdir

### Notable files
- Cargo.toml
- docs/research/git-complaints-and-tasknerve-v1-speed-plan-2026-03-09.md
- docs/.DS_Store
- docs/codex_native_integration_plan.md
- README.md
- src/main.rs

### Current project structure signals
- source lives under `src/`
- documentation lives alongside code in `docs/`
- template-driven assets or generated artifacts
- Codex skill or agent integration is shipped from the repo
- GitHub workflow automation is present

### Suggested working commands
- cargo build
- cargo test
- cargo run

### Top-level entries
- .DS_Store
- .editorconfig
- .gitattributes
- .github
- .gitignore
- CHANGELOG.md
- CODE_OF_CONDUCT.md
- CONTRIBUTING.md
- Cargo.lock
- Cargo.toml
- GOVERNANCE.md
- LICENSE
- README.md
- SECURITY.md
- TASKNERVE_WORKFLOW.md
- build.rs
- docs
- githooks
- install-linux.sh
- install-macos.sh

## Technical Contract

### Languages and runtimes
- Primary implementation language(s):
- Approved secondary language(s):
- Runtime targets and supported platforms:

### Libraries and frameworks
- Preferred libraries and frameworks:
- Libraries that should be avoided unless explicitly approved:

### Architecture and software patterns
- Module or service boundaries:
- State and data-flow rules:
- Error handling and logging expectations:
- Concurrency, async, or threading model:
- UI, API, or storage patterns that should be followed:

### Quality gates
- Required build, lint, test, and verification commands:
- Required review expectations:
- Required docs or release notes updates:

### Delivery rules
- Migration and compatibility strategy:
- Performance, security, and cost constraints:
- Rules for introducing new dependencies or patterns:

## Open Questions For The User
- [ ] Which current stack choices are intentional versus historical accidents?
- [ ] Which libraries are mandatory versus replaceable?
- [ ] Which software patterns should never be introduced here?
- [ ] Which quality gates are non-negotiable before work is considered done?

## Lock Status
- [ ] Mark this file as locked once the user and controller agree the technical contract is stable.
