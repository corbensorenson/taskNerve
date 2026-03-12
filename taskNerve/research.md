# TaskNerve Research

Project: taskNerve

## Current Findings
- Host-event-driven refresh paths materially reduce idle overhead compared to TTL polling.
- Large markdown edits are much more usable with near-fullscreen editor geometry.
- Bridge race conditions can appear during startup and should be handled with short retries.
- Clear controller/agent hierarchy lowers operator confusion and recovery time.
- Karpathy `autoresearch` uses a strong autonomous loop pattern: fixed budget, single mutable scope, objective metric, and strict keep/discard gating.
- That loop pattern transfers well to TaskNerve when implemented deterministically via bounded auto-generated maintenance tasks from runtime signals.
- Concurrent production-sync bursts can duplicate heavy git/CI/watchdog/trace work; per-repo inflight dedupe removes this redundant overhead.
- Short-lived trace-sync result reuse during burst refreshes cuts idle host/API load while preserving deterministic force-refresh behavior.
- Splitting monolithic runtime files into pure helper modules (host-runtime parsers/cache helpers and watchdog wait-hint heuristics) lowers maintenance risk without changing runtime behavior.
- Further splitting runtime contract/type blocks into dedicated `*.types.ts` modules reduces merge conflicts and keeps execution files focused on deterministic logic.
- Watchdog stall detection is more reliable when wait hints carry parsed durations (for example "3 hours"), allowing deterministic dynamic grace windows for long-running monitored jobs.
- Forced trace sync calls now use per-repo inflight de-dup (without TTL reuse) so concurrent `force` refreshes do not duplicate expensive thread reads/writes.

## Validated Practices
- Use deterministic project contract templates for all imports/creates.
- Keep project-specific settings local and explicit.
- Prefer compact sidebar actions with tooltips over text-heavy controls.
- Run continuous deterministic self-improvement passes from watchdog/quality-gate/git-sync signals with cooldown and open-task limits to avoid churn.

## Open Questions
- Best path for rendered markdown preview quality without heavy render cost.
- Whether markdown diff/history should be integrated directly into editor flow.
- How to expose project-scale perf telemetry in a low-noise way.
