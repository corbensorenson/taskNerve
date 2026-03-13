# TaskNerve Levers and Pitfalls

Project: taskNerve

## High-Leverage Moves
- Keep one implementation target: `codex-native/src` only.
- Make controller ownership explicit in every project section.
- Keep onboarding deterministic with required contracts and scripts.
- Favor event subscriptions over timers for live chrome updates.
- Validate syntax and route health after every source-first deploy.

## Common Pitfalls
- Direct edits to generated bundle artifacts under `target/*`.
- Introducing secondary source trees that drift from shipped behavior.
- Expanding polling without profiling impact under many open projects.
- Hiding bridge failures behind generic errors without retry/recovery.

## Guardrails
- Never hand-edit web bundle artifacts (for example `target/codex-tasknerve-app-live-extract/webview/assets/index-*.js`).
- Bridge reads/writes must surface clear actionable failures.
- Required docs must be auto-created and never optional for active projects.
- Controller reset must preserve old thread context via archival path.
