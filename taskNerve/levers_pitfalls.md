# TaskNerve Levers and Pitfalls

Project: taskNerve

## High-Leverage Moves
- Keep one runtime target and patch that path only.
- Make controller ownership explicit in every project section.
- Keep onboarding deterministic with required contracts and scripts.
- Favor event subscriptions over timers for live chrome updates.
- Validate syntax and route health after every runtime patch deploy.

## Common Pitfalls
- Styling-only patches that rely on missing generated utility classes.
- Introducing secondary source trees that drift from shipped behavior.
- Expanding polling without profiling impact under many open projects.
- Hiding bridge failures behind generic errors without retry/recovery.

## Guardrails
- Bridge reads/writes must surface clear actionable failures.
- Required docs must be auto-created and never optional for active projects.
- Controller reset must preserve old thread context via archival path.
