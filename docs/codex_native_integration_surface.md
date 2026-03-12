# Codex Native Integration Surface

Date: 2026-03-11

TaskNerve exposes direct in-process integration APIs from:

- [codex-native/src/integration/taskNerveService.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/taskNerveService.ts)
- [codex-native/src/integration/codexTaskNerveHostRuntime.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/codexTaskNerveHostRuntime.ts)

## Purpose

These surfaces let Codex host code call TaskNerve orchestration logic directly while inheriting Codex routing, threads, models, and styling.

## Core Services

Codex-first display surface:

`buildCodexConversationDisplaySnapshot()`:
- camelCase host contract for conversation rendering
- timestamped display entries for user/assistant/system/tool output
- prompt history jump controls for composer up/down buttons placed left of send/voice
- cached user-turn indexing for low-overhead navigation updates while scrolling/jumping
- virtualization window calculation for large threads
- scroll decision policy that avoids auto-pull while reading history (`stick-to-bottom`, `preserve-offset`, `jump-to-turn`, `no-op`)

`conversationInteractionStep()`:
- deterministic interaction reducer for thread scrolling/jump actions
- suppresses auto-scroll while the user is actively scrolling
- emits explicit commands for jump buttons and scroll decisions
- throttles repeated programmatic scroll commands to reduce jitter

`createTaskNerveService()`:
- project settings and registry IO
- per-repo mtime/raw caching for settings/registry reads with low-overhead cache lookups across many open projects
- settings/registry caches use bounded retention with hot-entry promotion to keep memory predictable at scale
- task queue sorting/filtering/stats
- structured task metadata support for high-signal worker handoff:
  - `objective`, `task_type`, `subsystem`
  - `files_in_scope`, `out_of_scope`
  - `acceptance_criteria`, `deliverables`, `verification_steps`
  - `implementation_notes`, `risk_notes`, `estimated_effort`
- memoized task snapshots for repeated task/search inputs
- precomputed task-search text to reduce per-query string normalization overhead on large queues
- normalized search-key reuse so equivalent queries (spacing/case variants) share filtered task results and stats
- prompt queue merge semantics
- model routing
- project contract generation
- controller bootstrap prompt generation
- `conversationDisplaySnapshot(...)` Codex-first conversation display API
- `conversationInteractionStep(...)` interaction command pipeline for native host scroll/jump handling
- `projectGitSyncSnapshot(...)` per-project git sync cadence and recommendation surface
- `projectSettingsAfterGitPush(...)` per-project push-history tracking update helper
- `projectCiTaskSyncPlan(...)` per-project CI failure triage to task-upsert planning
- `projectSettingsAfterCiSync(...)` per-project CI sync tracking update helper
- CI sync planning short-circuits when failure count is zero, avoiding unnecessary task indexing scans on large queues
- thread display snapshots (timestamped entries, prompt-history navigation, virtualization window, scroll decisions)

`createCodexTaskNerveHostRuntime()`:
- host-integrated snapshots with explicit host-styling contract
- direct controller-thread bootstrapping through Codex host service methods
- websocket-ready turn transport selection for controller bootstrap:
  - prefers `host.startTurnWebSocket(...)` when available in `auto` mode
  - supports explicit runtime override via `modelTransportMode` (`auto|http|websocket`)
  - falls back to `host.startTurn(...)` on websocket unavailability/failure
- host-exposed `modelTransportSnapshot(...)` for transport diagnostics
- host-exposed `conversationDisplaySnapshot(...)` for direct Codex thread rendering
- host-exposed `conversationInteractionStep(...)` for pure interaction reduction
- host-exposed `applyConversationInteraction(...)` to execute native scroll/jump commands when host methods exist
- host-exposed `projectGitSyncSnapshot(...)` for per-repo git sync metrics and recommendation
- host-exposed `syncProjectGit(...)` for smart pull/push execution with tracked push cadence
- git sync failures/policy blocks automatically escalate into a deterministic controller remediation task (`task.git-remediation.controller`) so git remains TaskNerve-managed and user hands-off
- host-exposed `projectCiSyncSnapshot(...)` for per-repo CI failure triage and task-upsert preview
- host-exposed `syncProjectCi(...)` for automatic CI failure task upsert + dispatch through host task APIs
- host-exposed `syncProjectTrace(...)` for deterministic per-project trace capture to `taskNerve/project_trace.ndjson`
- host-exposed `syncAgentWatchdog(...)` for deterministic stall recovery:
  - worker stall: reset worker thread directly and continue the same claimed task without controller escalation
  - controller stall: reset controller thread directly (no escalation task loop)
  - deterministic waiting-hint grace: suppresses resets for threads that explicitly report long-running monitoring/wait states (until grace window expires or a newer user turn arrives)
- `syncProjectProduction(...)` now runs trace sync as part of the integrated production pass
- `syncProjectProduction(...)` now also runs deterministic agent/controller watchdog recovery and reports reset counts
- `syncProjectProduction(...)` now runs a deterministic self-improvement planner:
  - converts runtime signals (watchdog resets, task-quality gate blocks, git-sync instability) into bounded maintenance tasks
  - reopens prior completed auto-improvement tasks when signals regress
  - enforces max tasks/run, open-task caps, and dispatch cooldown to avoid queue spam
- `syncProjectProduction(...)` dedupes concurrent smart runs per repo to prevent duplicate pull/push/CI/watchdog/trace work under burst triggers
- trace sync now uses per-repo short-lived cache + inflight dedupe for burst refreshes, while explicit `force` still bypasses cache
- `controllerProjectAutomation(...)` now runs trace sync as part of the controller automation pass
- host-exposed thread display snapshot method for native Codex thread UIs
- optional host-event refresh observers:
  - `observeThreadRefresh(...)` prefers `host.subscribeThreadEvents(...)`
  - `observeRepositorySettingsRefresh(...)` prefers `host.subscribeRepositorySettingsEvents(...)`
  - `observeConversationChromeRefresh(...)` prefers:
    - `host.subscribeTaskNerveTaskCountEvents(...)`
    - `host.subscribeTaskDrawerStateEvents(...)`
    - `host.subscribeTerminalPanelStateEvents(...)`
    - `host.subscribeTaskNerveBranchEvents(...)`
    - `host.subscribeTaskNerveResourceStatsEvents(...)`
  - all return fallback/manual mode when subscriptions are unavailable
- host-exposed `conversationChromeSnapshot(...)` for native Codex topbar/footer chrome state
- host-exposed `handleConversationChromeAction(...)` for task-drawer open, footer terminal toggle, and branch switch actions
- short-lived chrome-state cache to reduce host API read churn during bursty refresh cycles
- per-source short caches/inflight de-dup for task-count, drawer, terminal, branch, and resource reads to reduce redundant host calls when only some event subscriptions are available
- duplicate parsed chrome events are de-duplicated before forwarding to reduce unnecessary chrome update churn
- resource stats host reads are independently short-cached to avoid repeated expensive telemetry fetches during rapid chrome refreshes
- per-repo git/CI runtime caches are bounded with hot-entry promotion so memory remains stable across very large multi-project sessions
- CI sync snapshots short-cache agent discovery and request CI failures with a bounded limit to reduce host/API pressure
- CI failure payload normalization is capped per cycle to keep CPU predictable under noisy provider payloads
- chrome refresh can run in a hybrid model: event-updated fields bypass host reads, while unsupported fields continue TTL-backed host reads
- repository-settings refresh observers invalidate chrome cache; thread refresh observers stay display-focused to avoid chrome read churn during chatty thread events
- per-repo CI failure reads are short-cached with inflight de-dup to avoid repeated CI API pressure during burst sync cycles

## Example

```ts
import {
  createTaskNerveService,
  createCodexTaskNerveHostRuntime,
  buildCodexConversationDisplaySnapshot,
  conversationInteractionStep,
  buildCodexProjectGitSyncSnapshot,
  buildCodexProjectCiTaskSyncPlan,
} from "codex-tasknerve-native";

const taskNerve = createTaskNerveService();
const runtime = createCodexTaskNerveHostRuntime({
  host: codexHostServices,
  taskNerveService: taskNerve,
  modelTransportMode: "auto",
});

const snapshot = await runtime.snapshot({
  repoRoot,
  projectName,
  tasks,
  search,
});

const controller = await runtime.bootstrapControllerThread({
  repoRoot,
  projectName,
});

const transport = runtime.modelTransportSnapshot();

const threadDisplay = await runtime.conversationDisplaySnapshot({
  thread: rawThreadPayload,
  currentTurnKey,
  viewport: {
    scroll_top_px,
    scroll_height_px,
    viewport_height_px,
  },
});

const standaloneDisplay = buildCodexConversationDisplaySnapshot({
  thread: rawThreadPayload,
  currentTurnKey,
});

const interaction = conversationInteractionStep({
  snapshot: standaloneDisplay,
  state: previousInteractionState,
  event: {
    type: "jump-next-user-message",
  },
});

const applied = await runtime.applyConversationInteraction({
  snapshot: standaloneDisplay,
  state: previousInteractionState,
  event: {
    type: "jump-next-user-message",
  },
});

const gitSnapshot = await runtime.projectGitSyncSnapshot({
  repoRoot,
  tasks,
});

const gitSync = await runtime.syncProjectGit({
  repoRoot,
  tasks,
  mode: "smart",
});

const standaloneGit = buildCodexProjectGitSyncSnapshot({
  settings: snapshot.settings,
  tasks,
  git_state: gitSnapshot.repository,
});

const ciSnapshot = await runtime.projectCiSyncSnapshot({
  repoRoot,
  tasks,
});

const ciSync = await runtime.syncProjectCi({
  repoRoot,
  tasks,
});

const traceSync = await runtime.syncProjectTrace({
  repoRoot,
  projectName,
});

const standaloneCi = buildCodexProjectCiTaskSyncPlan({
  settings: snapshot.settings,
  tasks,
  failures: ciSnapshot.failures,
});

const chrome = await runtime.conversationChromeSnapshot();
const chromeRefresh = await runtime.observeConversationChromeRefresh({
  onEvent: (event) => {
    // event.source: task-count | task-drawer | terminal-panel | branch-state | resource-stats
  },
});
await runtime.handleConversationChromeAction({ type: "topbar-task-count-click" });
```

## Styling Contract

TaskNerve views should be rendered using Codex host components/styles.

No custom DOM overlay layer or external panel runtime is supported.
