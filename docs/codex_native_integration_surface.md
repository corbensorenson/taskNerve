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
- task queue sorting/filtering/stats
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
- thread display snapshots (timestamped entries, prompt-history navigation, virtualization window, scroll decisions)

`createCodexTaskNerveHostRuntime()`:
- host-integrated snapshots with explicit host-styling contract
- direct controller-thread bootstrapping through Codex host service methods
- host-exposed `conversationDisplaySnapshot(...)` for direct Codex thread rendering
- host-exposed `conversationInteractionStep(...)` for pure interaction reduction
- host-exposed `applyConversationInteraction(...)` to execute native scroll/jump commands when host methods exist
- host-exposed `projectGitSyncSnapshot(...)` for per-repo git sync metrics and recommendation
- host-exposed `syncProjectGit(...)` for smart pull/push execution with tracked push cadence
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
- chrome refresh can run in a hybrid model: event-updated fields bypass host reads, while unsupported fields continue TTL-backed host reads
- repository-settings refresh observers invalidate chrome cache; thread refresh observers stay display-focused to avoid chrome read churn during chatty thread events

## Example

```ts
import {
  createTaskNerveService,
  createCodexTaskNerveHostRuntime,
  buildCodexConversationDisplaySnapshot,
  conversationInteractionStep,
  buildCodexProjectGitSyncSnapshot,
} from "codex-tasknerve-native";

const taskNerve = createTaskNerveService();
const runtime = createCodexTaskNerveHostRuntime({ host: codexHostServices, taskNerveService: taskNerve });

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
