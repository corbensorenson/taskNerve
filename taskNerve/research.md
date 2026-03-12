# TaskNerve Research

Project: taskNerve

## Current Findings
- Host-event-driven refresh paths materially reduce idle overhead compared to TTL polling.
- Large markdown edits are much more usable with near-fullscreen editor geometry.
- Bridge race conditions can appear during startup and should be handled with short retries.
- Clear controller/agent hierarchy lowers operator confusion and recovery time.

## Validated Practices
- Use deterministic project contract templates for all imports/creates.
- Keep project-specific settings local and explicit.
- Prefer compact sidebar actions with tooltips over text-heavy controls.

## Open Questions
- Best path for rendered markdown preview quality without heavy render cost.
- Whether markdown diff/history should be integrated directly into editor flow.
- How to expose project-scale perf telemetry in a low-noise way.
