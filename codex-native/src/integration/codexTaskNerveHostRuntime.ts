import { CONTROLLER_AGENT_ID, nowIsoUtc } from "../constants.js";
import {
  assertCodexHostServices,
  type CodexHostSubscription,
  type CodexHostServices,
} from "../host/codexHostServices.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type {
  CodexConversationChromeSnapshot,
  CodexConversationChromeStateInput,
  CodexConversationChromeResourceStats,
} from "./codexConversationChrome.js";
import { buildCodexConversationChromeSnapshot } from "./codexConversationChrome.js";
import type {
  CodexConversationDisplayOptions,
  CodexConversationDisplaySnapshot,
} from "./codexConversationDisplay.js";
import type {
  CodexConversationInteractionCommand,
  CodexConversationInteractionInput,
  CodexConversationInteractionResult,
} from "./codexConversationInteraction.js";
import {
  planCodexProjectGitSync,
} from "./codexProjectGitSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";
import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import type { CodexProjectProductionSnapshot } from "./codexProjectProduction.js";
import {
  loadCodexProjectProductionContext,
  syncCodexProjectProduction,
  type CodexProjectProductionRunOptions,
  type CodexProjectProductionRunResult,
  type CodexProjectProductionSnapshotOptions,
} from "./codexProjectProductionRuntime.js";
import {
  runCodexControllerProjectAutomation,
  type CodexControllerProjectAutomationOptions,
  type CodexControllerProjectAutomationResult,
} from "./codexControllerProjectAutomation.js";
import {
  syncCodexProjectTrace,
  type CodexProjectTraceSyncResult,
} from "./codexProjectTrace.js";
import {
  runCodexAgentWatchdog,
  type CodexAgentWatchdogPolicy,
  type CodexAgentWatchdogRunResult,
} from "./codexAgentWatchdog.js";
import {
  resolveModelTransportPlan,
  startTurnWithResolvedModelTransport,
  type CodexModelTransportExecution,
  type CodexModelTransportMode,
  type CodexModelTransportPlan,
} from "./modelTransport.js";
import {
  escalateGitIssuesToController,
  type GitIssueSignal,
} from "./codexGitIssueRemediation.js";
import { createTaskNerveService, type TaskNerveService } from "./taskNerveService.js";
import type {
  BuildThreadDisplayOptions,
  ThreadDisplaySnapshot,
} from "./threadDisplay/index.js";
import {
  projectTraceManifestPath,
  projectTracePath,
  timelineProjectTraceStatePath,
} from "../io/paths.js";
import {
  getCachedMapValue,
  hasConversationChromeOverrides,
  normalizeHostSubscriptionDisposer,
  parseAgentIds,
  parseBranchState,
  parseBranchStatePatch,
  parseOpenState,
  parseOpenStateMaybe,
  parseResourceStats,
  parseResourceStatsPatch,
  parseStringArray,
  parseTaskCount,
  parseTaskCountMaybe,
  parseThreadId,
  rememberBoundedMapValue,
  sameResourceStats,
  sameStringArray,
  syncTaskMarker,
  type NormalizedBranchState,
} from "./codexTaskNerveHostRuntime.helpers.js";
import type {
  CodexControllerProjectAutomationWithTraceResult,
  CodexHostRefreshSubscription,
  CodexProjectCiSyncRunResult,
  CodexProjectGitSyncRunResult,
  CodexProjectProductionRunWithTraceResult,
  CodexRuntimeProjectTraceSyncOptions,
  CodexTaskNerveHostRuntime,
} from "./codexTaskNerveHostRuntime.types.js";

export type {
  CodexProjectProductionRunOptions,
  CodexProjectProductionRunResult,
  CodexProjectProductionSnapshotOptions,
} from "./codexProjectProductionRuntime.js";
export type {
  CodexControllerProjectAutomationOptions,
  CodexControllerProjectAutomationResult,
} from "./codexControllerProjectAutomation.js";
export type {
  CodexAgentWatchdogRunOptions,
  CodexControllerBootstrapOptions,
  CodexControllerBootstrapResult,
  CodexControllerProjectAutomationWithTraceResult,
  CodexConversationChromeAction,
  CodexConversationChromeActionResult,
  CodexConversationChromeRefreshEvent,
  CodexConversationChromeRefreshSource,
  CodexHostRefreshSubscription,
  CodexModelTransportSnapshot,
  CodexProjectCiSyncRunOptions,
  CodexProjectCiSyncRunResult,
  CodexProjectCiSyncSnapshotOptions,
  CodexProjectGitSyncRunOptions,
  CodexProjectGitSyncRunResult,
  CodexProjectGitSyncSnapshotOptions,
  CodexProjectProductionRunWithTraceResult,
  CodexRuntimeProjectTraceSyncOptions,
  CodexTaskNerveHostRuntime,
  CodexTaskNerveSnapshot,
  CodexTaskNerveSnapshotOptions,
  ObserveConversationChromeRefreshOptions,
  ObserveRepositorySettingsRefreshOptions,
  ObserveThreadRefreshOptions,
} from "./codexTaskNerveHostRuntime.types.js";

const HOST_STYLING_CONTEXT_CACHE_TTL_MS = 10_000;
const CONVERSATION_CHROME_CACHE_TTL_MS = 250;
const CHROME_STATE_CACHE_TTL_MS = 1_000;
const RESOURCE_STATS_CACHE_TTL_MS = 1_000;
const PROJECT_GIT_STATE_CACHE_TTL_MS = 2_500;
const PROJECT_CI_FAILURE_CACHE_TTL_MS = 7_500;
const PROJECT_CI_AGENT_CACHE_TTL_MS = 2_500;
const PROJECT_TRACE_SYNC_CACHE_TTL_MS = 3_000;
const PROJECT_STATE_CACHE_MAX_ENTRIES = 256;
const PROJECT_CI_FAILURE_FETCH_LIMIT = 256;

export function createCodexTaskNerveHostRuntime(options: {
  host: Partial<CodexHostServices> | null | undefined;
  taskNerveService?: TaskNerveService;
  env?: NodeJS.ProcessEnv;
  modelTransportMode?: CodexModelTransportMode | null;
}): CodexTaskNerveHostRuntime {
  const host = assertCodexHostServices(options.host);
  const taskNerve = options.taskNerveService ?? createTaskNerveService();
  const runtimeEnv = options.env ?? process.env;
  const runtimeModelTransportMode = options.modelTransportMode ?? null;
  let hostStylingContextCache: {
    value: unknown;
    fetchedAtMs: number;
  } | null = null;
  let hostStylingContextInflight: Promise<unknown> | null = null;
  let conversationChromeSnapshotCache: {
    snapshot: CodexConversationChromeSnapshot;
    fetchedAtMs: number;
  } | null = null;
  let conversationChromeSnapshotInflight: Promise<CodexConversationChromeSnapshot> | null = null;
  let taskCountCache: {
    value: number;
    fetchedAtMs: number;
  } | null = null;
  let taskCountInflight: Promise<number> | null = null;
  let taskDrawerOpenCache: {
    value: boolean;
    fetchedAtMs: number;
  } | null = null;
  let taskDrawerOpenInflight: Promise<boolean> | null = null;
  let terminalOpenCache: {
    value: boolean;
    fetchedAtMs: number;
  } | null = null;
  let terminalOpenInflight: Promise<boolean> | null = null;
  let branchStateCache: {
    value: NormalizedBranchState;
    fetchedAtMs: number;
  } | null = null;
  let branchStateInflight: Promise<NormalizedBranchState> | null = null;
  let resourceStatsCache: {
    value: Partial<CodexConversationChromeResourceStats>;
    fetchedAtMs: number;
  } | null = null;
  let resourceStatsInflight: Promise<Partial<CodexConversationChromeResourceStats>> | null = null;
  const projectGitStateCache = new Map<
    string,
    {
      value: unknown;
      fetchedAtMs: number;
    }
  >();
  const projectGitStateInflight = new Map<string, Promise<unknown>>();
  const projectGitSyncInflight = new Map<string, Promise<CodexProjectGitSyncRunResult>>();
  const projectCiFailureCache = new Map<
    string,
    {
      value: unknown;
      fetchedAtMs: number;
    }
  >();
  const projectCiFailureInflight = new Map<string, Promise<unknown>>();
  const projectCiSyncInflight = new Map<string, Promise<CodexProjectCiSyncRunResult>>();
  const projectTraceSyncCache = new Map<
    string,
    {
      result: CodexProjectTraceSyncResult;
      fetchedAtMs: number;
    }
  >();
  const projectTraceSyncInflight = new Map<string, Promise<CodexProjectTraceSyncResult>>();
  const projectProductionSyncInflight = new Map<
    string,
    Promise<CodexProjectProductionRunWithTraceResult>
  >();
  const controllerProjectAutomationInflight = new Map<
    string,
    Promise<CodexControllerProjectAutomationWithTraceResult>
  >();
  let projectCiAgentCache: {
    value: string[];
    fetchedAtMs: number;
  } | null = null;
  let projectCiAgentInflight: Promise<string[]> | null = null;
  const conversationChromeEventState: CodexConversationChromeStateInput = {};

  function mergedConversationChromeStateInput(
    input: CodexConversationChromeStateInput = {},
  ): CodexConversationChromeStateInput {
    return {
      taskCount:
        input.taskCount !== undefined ? input.taskCount : conversationChromeEventState.taskCount,
      taskDrawerOpen:
        input.taskDrawerOpen !== undefined
          ? input.taskDrawerOpen
          : conversationChromeEventState.taskDrawerOpen,
      terminalOpen:
        input.terminalOpen !== undefined
          ? input.terminalOpen
          : conversationChromeEventState.terminalOpen,
      currentBranch:
        input.currentBranch !== undefined
          ? input.currentBranch
          : conversationChromeEventState.currentBranch,
      branches: input.branches !== undefined ? input.branches : conversationChromeEventState.branches,
      resourceStats:
        input.resourceStats !== undefined
          ? input.resourceStats
          : conversationChromeEventState.resourceStats,
    };
  }

  async function loadHostStylingContext(): Promise<unknown> {
    if (typeof host.getCodexStylingContext !== "function") {
      return null;
    }
    const now = Date.now();
    if (
      hostStylingContextCache &&
      now - hostStylingContextCache.fetchedAtMs < HOST_STYLING_CONTEXT_CACHE_TTL_MS
    ) {
      return hostStylingContextCache.value;
    }
    if (hostStylingContextInflight) {
      return hostStylingContextInflight;
    }
    hostStylingContextInflight = Promise.resolve(host.getCodexStylingContext())
      .then((value) => {
        hostStylingContextCache = {
          value,
          fetchedAtMs: Date.now(),
        };
        return value;
      })
      .finally(() => {
        hostStylingContextInflight = null;
      });
    return hostStylingContextInflight;
  }

  async function loadTaskCount(
    override?: number,
    options?: { forceRefresh?: boolean },
  ): Promise<number> {
    if (Number.isFinite(override)) {
      return parseTaskCount(override);
    }
    if (typeof host.readTaskNerveTaskCount !== "function") {
      return 0;
    }
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();
    if (
      !forceRefresh &&
      taskCountCache &&
      now - taskCountCache.fetchedAtMs < CHROME_STATE_CACHE_TTL_MS
    ) {
      return taskCountCache.value;
    }
    if (!forceRefresh && taskCountInflight) {
      return taskCountInflight;
    }
    taskCountInflight = Promise.resolve(host.readTaskNerveTaskCount())
      .then((value) => {
        const normalized = parseTaskCount(value);
        taskCountCache = {
          value: normalized,
          fetchedAtMs: Date.now(),
        };
        return normalized;
      })
      .finally(() => {
        taskCountInflight = null;
      });
    return taskCountInflight;
  }

  async function loadTaskDrawerOpen(
    override?: boolean,
    options?: { forceRefresh?: boolean },
  ): Promise<boolean> {
    if (typeof override === "boolean") {
      return override;
    }
    if (typeof host.readTaskDrawerState !== "function") {
      return false;
    }
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();
    if (
      !forceRefresh &&
      taskDrawerOpenCache &&
      now - taskDrawerOpenCache.fetchedAtMs < CHROME_STATE_CACHE_TTL_MS
    ) {
      return taskDrawerOpenCache.value;
    }
    if (!forceRefresh && taskDrawerOpenInflight) {
      return taskDrawerOpenInflight;
    }
    taskDrawerOpenInflight = Promise.resolve(host.readTaskDrawerState())
      .then((value) => {
        const normalized = parseOpenState(value, false);
        taskDrawerOpenCache = {
          value: normalized,
          fetchedAtMs: Date.now(),
        };
        return normalized;
      })
      .finally(() => {
        taskDrawerOpenInflight = null;
      });
    return taskDrawerOpenInflight;
  }

  async function loadTerminalOpen(
    override?: boolean,
    options?: { forceRefresh?: boolean },
  ): Promise<boolean> {
    if (typeof override === "boolean") {
      return override;
    }
    if (typeof host.readTerminalPanelState !== "function") {
      return false;
    }
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();
    if (
      !forceRefresh &&
      terminalOpenCache &&
      now - terminalOpenCache.fetchedAtMs < CHROME_STATE_CACHE_TTL_MS
    ) {
      return terminalOpenCache.value;
    }
    if (!forceRefresh && terminalOpenInflight) {
      return terminalOpenInflight;
    }
    terminalOpenInflight = Promise.resolve(host.readTerminalPanelState())
      .then((value) => {
        const normalized = parseOpenState(value, false);
        terminalOpenCache = {
          value: normalized,
          fetchedAtMs: Date.now(),
        };
        return normalized;
      })
      .finally(() => {
        terminalOpenInflight = null;
      });
    return terminalOpenInflight;
  }

  async function loadBranches(overrides: {
    currentBranch?: string | null;
    branches?: string[];
    forceRefresh?: boolean;
  }): Promise<NormalizedBranchState> {
    if (overrides.currentBranch !== undefined || overrides.branches !== undefined) {
      return parseBranchState({
        currentBranch: overrides.currentBranch ?? null,
        branches: overrides.branches ?? [],
      });
    }
    if (typeof host.listTaskNerveBranches !== "function") {
      return { currentBranch: null, branches: [] };
    }
    const forceRefresh = overrides.forceRefresh === true;
    const now = Date.now();
    if (
      !forceRefresh &&
      branchStateCache &&
      now - branchStateCache.fetchedAtMs < CHROME_STATE_CACHE_TTL_MS
    ) {
      return branchStateCache.value;
    }
    if (!forceRefresh && branchStateInflight) {
      return branchStateInflight;
    }
    branchStateInflight = Promise.resolve(host.listTaskNerveBranches())
      .then((value) => {
        const normalized = parseBranchState(value);
        branchStateCache = {
          value: normalized,
          fetchedAtMs: Date.now(),
        };
        return normalized;
      })
      .finally(() => {
        branchStateInflight = null;
      });
    return branchStateInflight;
  }

  async function loadResourceStats(
    override?: Partial<CodexConversationChromeResourceStats> | null,
  ): Promise<Partial<CodexConversationChromeResourceStats>> {
    if (override) {
      return override;
    }
    if (typeof host.readTaskNerveResourceStats !== "function") {
      return {};
    }
    const now = Date.now();
    if (resourceStatsCache && now - resourceStatsCache.fetchedAtMs < RESOURCE_STATS_CACHE_TTL_MS) {
      return resourceStatsCache.value;
    }
    if (resourceStatsInflight) {
      return resourceStatsInflight;
    }
    resourceStatsInflight = Promise.resolve(host.readTaskNerveResourceStats())
      .then((value) => {
        const normalized = parseResourceStats(value);
        resourceStatsCache = {
          value: normalized,
          fetchedAtMs: Date.now(),
        };
        return normalized;
      })
      .finally(() => {
        resourceStatsInflight = null;
      });
    return resourceStatsInflight;
  }

  function invalidateProjectGitStateCache(repoRoot?: string | null) {
    const key = typeof repoRoot === "string" ? repoRoot.trim() : "";
    if (key) {
      projectGitStateCache.delete(key);
      projectGitStateInflight.delete(key);
      return;
    }
    projectGitStateCache.clear();
    projectGitStateInflight.clear();
  }

  async function loadProjectGitState(repoRoot: string, override?: unknown): Promise<unknown> {
    if (override !== undefined) {
      return override;
    }
    if (typeof host.readRepositoryGitState !== "function") {
      return null;
    }
    const key = repoRoot.trim();
    if (!key) {
      return null;
    }
    const now = Date.now();
    const cached = getCachedMapValue(projectGitStateCache, key);
    if (cached && now - cached.fetchedAtMs < PROJECT_GIT_STATE_CACHE_TTL_MS) {
      return cached.value;
    }
    const inflight = projectGitStateInflight.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = Promise.resolve(host.readRepositoryGitState({ repoRoot: key }))
      .then((value) => {
        rememberBoundedMapValue(
          projectGitStateCache,
          key,
          {
            value,
            fetchedAtMs: Date.now(),
          },
          PROJECT_STATE_CACHE_MAX_ENTRIES,
        );
        return value;
      })
      .finally(() => {
        projectGitStateInflight.delete(key);
      });
    projectGitStateInflight.set(key, promise);
    return promise;
  }

  async function loadProjectGitSyncContext(options: {
    repoRoot: string;
    tasks?: Partial<TaskRecord>[];
    nowIsoUtc?: string | null;
    gitState?: unknown;
  }): Promise<{
    settings: ProjectCodexSettings;
    snapshot: ProjectGitSyncSnapshot;
  }> {
    const settings = await taskNerve.loadProjectSettings({
      repoRoot: options.repoRoot,
    });
    const gitState = await loadProjectGitState(options.repoRoot, options.gitState);
    const snapshot = taskNerve.projectGitSyncSnapshot({
      settings,
      tasks: options.tasks,
      git_state: gitState,
      now_iso: options.nowIsoUtc ?? undefined,
    });
    return {
      settings,
      snapshot,
    };
  }

  async function loadProjectCiAgentIds(overrides?: unknown): Promise<string[]> {
    let availableAgentIds = parseStringArray(overrides);
    if (availableAgentIds.length > 0 || typeof host.listTaskNerveAgents !== "function") {
      return availableAgentIds;
    }

    const now = Date.now();
    if (projectCiAgentCache && now - projectCiAgentCache.fetchedAtMs < PROJECT_CI_AGENT_CACHE_TTL_MS) {
      return projectCiAgentCache.value;
    }

    if (!projectCiAgentInflight) {
      projectCiAgentInflight = Promise.resolve(host.listTaskNerveAgents())
        .then((value) => {
          const parsed = parseAgentIds(value);
          projectCiAgentCache = {
            value: parsed,
            fetchedAtMs: Date.now(),
          };
          return parsed;
        })
        .finally(() => {
          projectCiAgentInflight = null;
        });
    }
    availableAgentIds = await projectCiAgentInflight;
    return availableAgentIds;
  }

  function invalidateProjectCiFailureCache(repoRoot?: string | null) {
    const key = typeof repoRoot === "string" ? repoRoot.trim() : "";
    if (key) {
      projectCiFailureCache.delete(key);
      projectCiFailureInflight.delete(key);
      return;
    }
    projectCiFailureCache.clear();
    projectCiFailureInflight.clear();
  }

  async function loadProjectCiFailures(
    repoRoot: string,
    override?: unknown,
    options: {
      forceRefresh?: boolean;
    } = {},
  ): Promise<unknown> {
    if (override !== undefined) {
      return override;
    }
    if (typeof host.readRepositoryCiFailures !== "function") {
      return [];
    }
    const key = repoRoot.trim();
    if (!key) {
      return [];
    }
    const forceRefresh = options.forceRefresh === true;
    const now = Date.now();
    const cached = getCachedMapValue(projectCiFailureCache, key);
    if (!forceRefresh && cached && now - cached.fetchedAtMs < PROJECT_CI_FAILURE_CACHE_TTL_MS) {
      return cached.value;
    }
    if (!forceRefresh) {
      const inflight = projectCiFailureInflight.get(key);
      if (inflight) {
        return inflight;
      }
    }

    const promise = Promise.resolve(
      host.readRepositoryCiFailures({ repoRoot: key, limit: PROJECT_CI_FAILURE_FETCH_LIMIT }),
    )
      .then((value) => {
        rememberBoundedMapValue(
          projectCiFailureCache,
          key,
          {
            value,
            fetchedAtMs: Date.now(),
          },
          PROJECT_STATE_CACHE_MAX_ENTRIES,
        );
        return value;
      })
      .finally(() => {
        projectCiFailureInflight.delete(key);
      });
    projectCiFailureInflight.set(key, promise);
    return promise;
  }

  async function loadProjectCiSyncContext(options: {
    repoRoot: string;
    tasks?: Partial<TaskRecord>[];
    ciFailures?: unknown;
    availableAgentIds?: string[];
    nowIsoUtc?: string | null;
  }): Promise<{
    settings: ProjectCodexSettings;
    snapshot: ProjectCiTaskSyncPlan;
    ciFailures: unknown;
    availableAgentIds: string[];
  }> {
    const settings = await taskNerve.loadProjectSettings({
      repoRoot: options.repoRoot,
    });
    const availableAgentIds = await loadProjectCiAgentIds(options.availableAgentIds);
    const ciFailures = await loadProjectCiFailures(options.repoRoot, options.ciFailures);
    const snapshot = taskNerve.projectCiTaskSyncPlan({
      settings,
      tasks: options.tasks,
      failures: ciFailures,
      available_agent_ids: availableAgentIds,
      now_iso: options.nowIsoUtc ?? undefined,
    });
    return {
      settings,
      snapshot,
      ciFailures,
      availableAgentIds,
    };
  }

  async function subscribeWithFallback(options: {
    subscribe: unknown;
    listener: (event: unknown) => void;
    subscribeArgs?: unknown[];
    onFallbackRefresh?: () => void;
  }): Promise<CodexHostRefreshSubscription> {
    const subscribe =
      typeof options.subscribe === "function"
        ? (options.subscribe as (
            listener: (event: unknown) => void,
            ...rest: unknown[]
          ) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void)
        : null;
    if (!subscribe) {
      if (typeof options.onFallbackRefresh === "function") {
        options.onFallbackRefresh();
      }
      return {
        mode: "fallback-manual-refresh",
        dispose: () => {},
      };
    }

    const subscription = await Promise.resolve(
      subscribe(options.listener, ...(options.subscribeArgs ?? [])),
    );
    return {
      mode: "host-event-subscription",
      dispose: normalizeHostSubscriptionDisposer(subscription),
    };
  }

  async function subscribeOptional(options: {
    subscribe: unknown;
    listener: (event: unknown) => void;
    subscribeArgs?: unknown[];
  }): Promise<(() => void) | null> {
    const subscribe =
      typeof options.subscribe === "function"
        ? (options.subscribe as (
            listener: (event: unknown) => void,
            ...rest: unknown[]
          ) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void)
        : null;
    if (!subscribe) {
      return null;
    }
    const subscription = await Promise.resolve(
      subscribe(options.listener, ...(options.subscribeArgs ?? [])),
    );
    return normalizeHostSubscriptionDisposer(subscription);
  }

  async function loadConversationChromeSnapshot(
    stateInput: CodexConversationChromeStateInput = {},
  ): Promise<CodexConversationChromeSnapshot> {
    const [taskCount, taskDrawerOpen, terminalOpen, branchState, resourceStats] = await Promise.all([
      loadTaskCount(stateInput.taskCount),
      loadTaskDrawerOpen(stateInput.taskDrawerOpen),
      loadTerminalOpen(stateInput.terminalOpen),
      loadBranches({
        currentBranch: stateInput.currentBranch,
        branches: stateInput.branches,
      }),
      loadResourceStats(stateInput.resourceStats),
    ]);

    return buildCodexConversationChromeSnapshot({
      taskCount,
      taskDrawerOpen,
      terminalOpen,
      currentBranch: branchState.currentBranch,
      branches: branchState.branches,
      resourceStats,
    });
  }

  function invalidateConversationChromeCache(options?: { clearReadCaches?: boolean }) {
    conversationChromeSnapshotCache = null;
    if (options?.clearReadCaches) {
      taskCountCache = null;
      taskCountInflight = null;
      taskDrawerOpenCache = null;
      taskDrawerOpenInflight = null;
      terminalOpenCache = null;
      terminalOpenInflight = null;
      branchStateCache = null;
      branchStateInflight = null;
      resourceStatsCache = null;
      resourceStatsInflight = null;
    }
  }

  function applyConversationChromeEventPatch(
    patch: Partial<CodexConversationChromeStateInput>,
  ): boolean {
    let changed = false;
    let branchStateChanged = false;
    const nowMs = Date.now();

    if (
      patch.taskCount !== undefined &&
      patch.taskCount !== conversationChromeEventState.taskCount
    ) {
      conversationChromeEventState.taskCount = patch.taskCount;
      taskCountCache = {
        value: parseTaskCount(patch.taskCount),
        fetchedAtMs: nowMs,
      };
      changed = true;
    }

    if (
      patch.taskDrawerOpen !== undefined &&
      patch.taskDrawerOpen !== conversationChromeEventState.taskDrawerOpen
    ) {
      conversationChromeEventState.taskDrawerOpen = patch.taskDrawerOpen;
      taskDrawerOpenCache = {
        value: Boolean(patch.taskDrawerOpen),
        fetchedAtMs: nowMs,
      };
      changed = true;
    }

    if (
      patch.terminalOpen !== undefined &&
      patch.terminalOpen !== conversationChromeEventState.terminalOpen
    ) {
      conversationChromeEventState.terminalOpen = patch.terminalOpen;
      terminalOpenCache = {
        value: Boolean(patch.terminalOpen),
        fetchedAtMs: nowMs,
      };
      changed = true;
    }

    if (
      patch.currentBranch !== undefined &&
      patch.currentBranch !== conversationChromeEventState.currentBranch
    ) {
      conversationChromeEventState.currentBranch = patch.currentBranch;
      branchStateChanged = true;
      changed = true;
    }

    if (
      patch.branches !== undefined &&
      !sameStringArray(patch.branches, conversationChromeEventState.branches)
    ) {
      conversationChromeEventState.branches = patch.branches;
      branchStateChanged = true;
      changed = true;
    }

    if (branchStateChanged) {
      branchStateCache = {
        value: parseBranchState({
          currentBranch: conversationChromeEventState.currentBranch ?? null,
          branches: conversationChromeEventState.branches ?? [],
        }),
        fetchedAtMs: nowMs,
      };
    }

    if (patch.resourceStats !== undefined) {
      const previousStats = conversationChromeEventState.resourceStats ?? undefined;
      const nextStats = {
        ...(previousStats ?? {}),
        ...(patch.resourceStats ?? {}),
      };
      if (!sameResourceStats(previousStats, nextStats)) {
        conversationChromeEventState.resourceStats = nextStats;
        resourceStatsCache = {
          value: nextStats,
          fetchedAtMs: nowMs,
        };
        changed = true;
      }
    }

    if (changed) {
      invalidateConversationChromeCache();
    }
    return changed;
  }

  async function applyConversationInteractionCommand(
    command: CodexConversationInteractionCommand,
  ): Promise<boolean> {
    switch (command.type) {
      case "set-current-turn-key": {
        if (typeof host.setConversationCurrentTurnKey !== "function") {
          return false;
        }
        await host.setConversationCurrentTurnKey(command.turnKey);
        return true;
      }

      case "scroll-to-turn": {
        if (typeof host.scrollConversationToTurn !== "function") {
          return false;
        }
        await host.scrollConversationToTurn(command.turnKey, {
          behavior: command.behavior,
          align: command.align,
        });
        return true;
      }

      case "scroll-to-top": {
        if (typeof host.scrollConversationToTop !== "function") {
          return false;
        }
        await host.scrollConversationToTop(command.scrollTopPx, {
          behavior: command.behavior,
        });
        return true;
      }
    }
  }

  async function syncProjectTraceStrict(
    traceOptions: CodexRuntimeProjectTraceSyncOptions,
  ): Promise<CodexProjectTraceSyncResult> {
    const settings = traceOptions.settings
      ? taskNerve.normalizeProjectSettings(traceOptions.settings)
      : await taskNerve.loadProjectSettings({
          repoRoot: traceOptions.repoRoot,
        });
    const threadsPayload =
      traceOptions.threadsPayload !== undefined
        ? traceOptions.threadsPayload
        : await Promise.resolve(host.listProjectThreads());
    return syncCodexProjectTrace({
      repoRoot: traceOptions.repoRoot,
      projectName: traceOptions.projectName ?? null,
      settings,
      threadsPayload,
      nowIsoUtc: traceOptions.nowIsoUtc,
      force: traceOptions.force,
    });
  }

  function traceSyncDedupeKey(
    traceOptions: CodexRuntimeProjectTraceSyncOptions,
  ): string | null {
    const repoRoot = traceOptions.repoRoot.trim();
    if (!repoRoot) {
      return null;
    }
    if (traceOptions.threadsPayload !== undefined || traceOptions.settings !== undefined) {
      return null;
    }
    return `${repoRoot}::${traceOptions.projectName ?? ""}`;
  }

  async function syncProjectTraceSafe(
    traceOptions: CodexRuntimeProjectTraceSyncOptions,
  ): Promise<CodexProjectTraceSyncResult> {
    const dedupeKey = traceSyncDedupeKey(traceOptions);
    const cacheEligible = !!dedupeKey && traceOptions.force !== true;
    const now = Date.now();
    if (cacheEligible && dedupeKey) {
      const cached = getCachedMapValue(projectTraceSyncCache, dedupeKey);
      if (cached && now - cached.fetchedAtMs < PROJECT_TRACE_SYNC_CACHE_TTL_MS) {
        return cached.result;
      }
    }
    if (dedupeKey) {
      const inflight = projectTraceSyncInflight.get(dedupeKey);
      if (inflight) {
        return inflight;
      }
    }

    const run: Promise<CodexProjectTraceSyncResult> = (async (): Promise<CodexProjectTraceSyncResult> => {
      try {
        return await syncProjectTraceStrict(traceOptions);
      } catch (error) {
        const fallbackSettings = taskNerve.normalizeProjectSettings(traceOptions.settings ?? {});
        const syncedAtUtc = traceOptions.nowIsoUtc ?? nowIsoUtc();
        const message = error instanceof Error ? error.message : String(error);
        return {
          integration_mode: "codex-native-host",
          repo_root: traceOptions.repoRoot,
          project_name: traceOptions.projectName ?? null,
          enabled: false,
          reason: "disabled",
          trace_path: projectTracePath(traceOptions.repoRoot),
          manifest_path: projectTraceManifestPath(traceOptions.repoRoot),
          state_path: timelineProjectTraceStatePath(traceOptions.repoRoot),
          threads_seen: 0,
          threads_in_scope: 0,
          entries_seen: 0,
          entries_appended: 0,
          total_entries_written: 0,
          trace_settings: {
            capture_controller: fallbackSettings.trace_capture_controller,
            capture_agents: fallbackSettings.trace_capture_agents,
            include_message_content: fallbackSettings.trace_include_message_content,
            max_content_chars: fallbackSettings.trace_max_content_chars,
          },
          synced_at_utc: syncedAtUtc,
          warnings: [`Trace sync failed: ${message}`],
        };
      }
    })();

    if (!dedupeKey) {
      return run;
    }
    projectTraceSyncInflight.set(dedupeKey, run);
    try {
      const result = await run;
      if (cacheEligible) {
        rememberBoundedMapValue(
          projectTraceSyncCache,
          dedupeKey,
          {
            result,
            fetchedAtMs: Date.now(),
          },
          PROJECT_STATE_CACHE_MAX_ENTRIES,
        );
      }
      return result;
    } finally {
      projectTraceSyncInflight.delete(dedupeKey);
    }
  }

  return {
    snapshot: async (snapshotOptions) => {
      const settingsPromise = taskNerve.loadProjectSettings({
        repoRoot: snapshotOptions.repoRoot,
        gitOriginUrl: snapshotOptions.gitOriginUrl,
      });
      const hostStylingContextPromise = loadHostStylingContext();
      const taskSnapshot = taskNerve.taskSnapshot(snapshotOptions.tasks, snapshotOptions.search || "");
      const [settings, hostStylingContext] = await Promise.all([
        settingsPromise,
        hostStylingContextPromise,
      ]);
      return {
        integration_mode: "codex-native-host",
        styling: {
          inherit_codex_host: true,
          render_mode: "host-components-only",
        },
        host_styling_context: hostStylingContext,
        project_name: snapshotOptions.projectName,
        repo_root: snapshotOptions.repoRoot,
        settings,
        task_snapshot: taskSnapshot,
      };
    },

    modelTransportSnapshot: () => {
      const plan = resolveModelTransportPlan(host, runtimeEnv, {
        requestedMode: runtimeModelTransportMode,
      });
      return {
        integration_mode: "codex-native-host",
        requested_mode: plan.requested_mode,
        resolved_mode: plan.resolved_mode,
        websocket_available: plan.websocket_available,
        fallback_reason: plan.fallback_reason,
      };
    },

    projectGitSyncSnapshot: async (projectOptions) => {
      const context = await loadProjectGitSyncContext({
        repoRoot: projectOptions.repoRoot,
        tasks: projectOptions.tasks,
        nowIsoUtc: projectOptions.nowIsoUtc,
        gitState: projectOptions.gitState,
      });
      return context.snapshot;
    },

    syncProjectGit: async (syncOptions) => {
      const repoKey = syncOptions.repoRoot.trim();
      const dedupeKey = repoKey
        ? `${repoKey}::${syncTaskMarker(syncOptions.tasks)}::${syncOptions.mode ?? "smart"}::${syncOptions.autostash !== false ? "autostash" : "no-autostash"}::${syncOptions.force === true ? "force" : "guarded"}::${syncOptions.autoSwitchPreferredBranch !== false ? "auto-branch" : "fixed-branch"}::${syncOptions.nowIsoUtc ?? ""}`
        : "";
      if (repoKey) {
        const inflight = projectGitSyncInflight.get(dedupeKey);
        if (inflight) {
          return inflight;
        }
      }

      const run: Promise<CodexProjectGitSyncRunResult> = (async (): Promise<CodexProjectGitSyncRunResult> => {
        const context = await loadProjectGitSyncContext({
          repoRoot: syncOptions.repoRoot,
          tasks: syncOptions.tasks,
          nowIsoUtc: syncOptions.nowIsoUtc,
        });
        const warnings: string[] = [];
        const gitIssues: GitIssueSignal[] = [];
        let pulled = false;
        let pushed = false;
        let effectiveSettings = context.settings;
        let effectiveSnapshot = context.snapshot;

      const preferredBranch = effectiveSnapshot.push_policy.preferred_branch;
      if (
        syncOptions.autoSwitchPreferredBranch !== false &&
        typeof preferredBranch === "string" &&
        preferredBranch.trim() &&
        effectiveSnapshot.branch_status.current_branch !== preferredBranch &&
        typeof host.switchTaskNerveBranch === "function"
      ) {
        try {
          await host.switchTaskNerveBranch(preferredBranch);
          invalidateProjectGitStateCache(syncOptions.repoRoot);
          const refreshedGitState = await loadProjectGitState(syncOptions.repoRoot);
          effectiveSnapshot = taskNerve.projectGitSyncSnapshot({
            settings: effectiveSettings,
            tasks: syncOptions.tasks,
            git_state: refreshedGitState,
            now_iso: syncOptions.nowIsoUtc ?? undefined,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Branch switch failed: ${message}`);
          gitIssues.push({
            key: `branch-switch-failed:${preferredBranch}`,
            phase: "branch-switch",
            summary: `Preferred branch switch to ${preferredBranch} failed`,
            detail: message,
          });
        }
      } else if (
        syncOptions.autoSwitchPreferredBranch !== false &&
        typeof preferredBranch === "string" &&
        preferredBranch.trim() &&
        effectiveSnapshot.branch_status.current_branch !== preferredBranch &&
        typeof host.switchTaskNerveBranch !== "function"
      ) {
        warnings.push("Codex host method switchTaskNerveBranch is unavailable");
        gitIssues.push({
          key: `branch-switch-method-unavailable:${preferredBranch}`,
          phase: "branch-switch",
          summary: "Codex host method switchTaskNerveBranch is unavailable",
          detail: `Preferred branch ${preferredBranch} could not be activated automatically`,
        });
      }

      const plan = planCodexProjectGitSync({
        mode: syncOptions.mode,
        snapshot: effectiveSnapshot,
      });

      if (plan.should_pull) {
        if (typeof host.pullRepository !== "function") {
          warnings.push("Codex host method pullRepository is unavailable");
          gitIssues.push({
            key: "pull-method-unavailable",
            phase: "pull",
            summary: "Codex host method pullRepository is unavailable",
          });
        } else {
          try {
            await host.pullRepository({
              repoRoot: syncOptions.repoRoot,
              autostash: syncOptions.autostash ?? true,
            });
            pulled = true;
            invalidateProjectGitStateCache(syncOptions.repoRoot);
            const refreshedGitState = await loadProjectGitState(syncOptions.repoRoot);
            effectiveSnapshot = taskNerve.projectGitSyncSnapshot({
              settings: effectiveSettings,
              tasks: syncOptions.tasks,
              git_state: refreshedGitState,
              now_iso: syncOptions.nowIsoUtc ?? undefined,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Pull failed: ${message}`);
            gitIssues.push({
              key: "pull-failed",
              phase: "pull",
              summary: "TaskNerve pull operation failed",
              detail: message,
            });
          }
        }
      }

      const pushBlockedReason = effectiveSnapshot.recommendation.push_blocked_reason;
      const ignoreInsufficientVolumeBlock =
        plan.mode !== "smart" && pushBlockedReason === "insufficient-task-volume";
      const hardBlockedByPolicy =
        plan.should_push &&
        pushBlockedReason !== null &&
        !ignoreInsufficientVolumeBlock &&
        syncOptions.force !== true;

      if (hardBlockedByPolicy) {
        warnings.push(`Push skipped: ${pushBlockedReason}`);
        if (pushBlockedReason) {
          gitIssues.push({
            key: `push-blocked:${pushBlockedReason}`,
            phase: "policy",
            summary: `Push blocked by policy: ${pushBlockedReason}`,
          });
        }
      } else if (
        plan.reason === "smart-push-blocked" &&
        pushBlockedReason !== null &&
        pushBlockedReason !== "insufficient-task-volume"
      ) {
        warnings.push(`Git sync blocked: ${pushBlockedReason}`);
        gitIssues.push({
          key: `smart-push-blocked:${pushBlockedReason}`,
          phase: "policy",
          summary: `Smart git sync is blocked: ${pushBlockedReason}`,
        });
      } else if (plan.should_push) {
        if (typeof host.pushRepository !== "function") {
          warnings.push("Codex host method pushRepository is unavailable");
          gitIssues.push({
            key: "push-method-unavailable",
            phase: "push",
            summary: "Codex host method pushRepository is unavailable",
          });
        } else {
          try {
            await host.pushRepository({
              repoRoot: syncOptions.repoRoot,
            });
            pushed = true;
            effectiveSettings = taskNerve.projectSettingsAfterGitPush({
              settings: effectiveSettings,
              tasks: syncOptions.tasks,
              pushed_at_utc: syncOptions.nowIsoUtc ?? undefined,
            });
            await taskNerve.writeProjectSettings(syncOptions.repoRoot, effectiveSettings);
            invalidateProjectGitStateCache(syncOptions.repoRoot);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Push failed: ${message}`);
            gitIssues.push({
              key: "push-failed",
              phase: "push",
              summary: "TaskNerve push operation failed",
              detail: message,
            });
          }
        }
      }

      let afterGitState: unknown = null;
      try {
        afterGitState = await loadProjectGitState(syncOptions.repoRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to read repository git state: ${message}`);
        gitIssues.push({
          key: "git-state-read-failed",
          phase: "policy",
          summary: "TaskNerve could not refresh repository git state after sync",
          detail: message,
        });
      }
      const after = taskNerve.projectGitSyncSnapshot({
        settings: effectiveSettings,
        tasks: syncOptions.tasks,
        git_state: afterGitState,
        now_iso: syncOptions.nowIsoUtc ?? undefined,
      });
      const remediation = await escalateGitIssuesToController({
        host,
        taskNerve,
        repoRoot: syncOptions.repoRoot,
        nowIsoUtc: syncOptions.nowIsoUtc,
        settings: effectiveSettings,
        tasks: syncOptions.tasks,
        issues: gitIssues,
      });
      warnings.push(...remediation.warnings);

        return {
          integration_mode: "codex-native-host",
          mode: plan.mode,
          executed: {
            pull: pulled,
            push: pushed,
          },
          plan_reason: plan.reason,
          before: context.snapshot,
          after,
          warnings,
        };
      })();

      if (!repoKey) {
        return run;
      }
      projectGitSyncInflight.set(dedupeKey, run);
      try {
        return await run;
      } finally {
        projectGitSyncInflight.delete(dedupeKey);
      }
    },

    projectCiSyncSnapshot: async (projectOptions) => {
      const context = await loadProjectCiSyncContext({
        repoRoot: projectOptions.repoRoot,
        tasks: projectOptions.tasks,
        ciFailures: projectOptions.ciFailures,
        availableAgentIds: projectOptions.availableAgentIds,
        nowIsoUtc: projectOptions.nowIsoUtc,
      });
      return context.snapshot;
    },

    syncProjectCi: async (syncOptions) => {
      const repoKey = syncOptions.repoRoot.trim();
      const dedupeKey = repoKey
        ? `${repoKey}::${syncTaskMarker(syncOptions.tasks)}::${syncOptions.persistTasks !== false ? "persist" : "no-persist"}::${syncOptions.dispatch !== false ? "dispatch" : "no-dispatch"}::${syncOptions.nowIsoUtc ?? ""}`
        : "";
      const dedupeEligible =
        !!repoKey &&
        syncOptions.ciFailures === undefined &&
        syncOptions.availableAgentIds === undefined;
      if (dedupeEligible) {
        const inflight = projectCiSyncInflight.get(dedupeKey);
        if (inflight) {
          return inflight;
        }
      }

      const run: Promise<CodexProjectCiSyncRunResult> = (async (): Promise<CodexProjectCiSyncRunResult> => {
        const context = await loadProjectCiSyncContext({
          repoRoot: syncOptions.repoRoot,
          tasks: syncOptions.tasks,
          ciFailures: syncOptions.ciFailures,
          availableAgentIds: syncOptions.availableAgentIds,
          nowIsoUtc: syncOptions.nowIsoUtc,
        });
        const warnings: string[] = [];
        let persistedTaskUpserts = 0;
        let dispatchedTaskIds: string[] = [];

        const settingsAfterSync = await taskNerve.writeProjectSettings(
          syncOptions.repoRoot,
          taskNerve.projectSettingsAfterCiSync({
            settings: context.settings,
            failed_job_count: context.snapshot.ci_metrics.unique_failure_count,
            synced_at_utc: syncOptions.nowIsoUtc ?? undefined,
          }),
        );

        const taskPayload = context.snapshot.task_upserts.map((entry) => entry.task);
        if (!context.snapshot.policy.auto_task_enabled) {
          warnings.push("CI auto-tasking is disabled in project settings");
        } else if (syncOptions.persistTasks === false) {
          warnings.push("CI task persistence skipped by request");
        } else if (taskPayload.length > 0) {
          if (typeof host.upsertTaskNerveProjectTasks !== "function") {
            warnings.push("Codex host method upsertTaskNerveProjectTasks is unavailable");
          } else {
            await host.upsertTaskNerveProjectTasks({
              repoRoot: syncOptions.repoRoot,
              tasks: taskPayload,
            });
            persistedTaskUpserts = taskPayload.length;
          }
        }

        const shouldDispatch = syncOptions.dispatch !== false;
        if (!shouldDispatch) {
          // Explicit opt-out: keep snapshot output but skip host dispatch call.
        } else if (!context.snapshot.policy.auto_task_enabled) {
          // Auto-tasking disabled; dispatch is intentionally suppressed.
        } else if (persistedTaskUpserts <= 0 || context.snapshot.dispatch_task_ids.length === 0) {
          // Nothing new to dispatch.
        } else if (typeof host.dispatchTaskNerveTasks !== "function") {
          warnings.push("Codex host method dispatchTaskNerveTasks is unavailable");
        } else {
          const qualityGate = taskNerve.gateDispatchTaskIdsByQuality({
            settings: settingsAfterSync,
            task_ids: context.snapshot.dispatch_task_ids,
            tasks: context.snapshot.task_upserts.map((entry) => entry.task),
          });
          if (qualityGate.blocked_task_ids.length > 0) {
            warnings.push(
              `Task quality gate blocked ${qualityGate.blocked_task_ids.length} dispatch item(s): ${qualityGate.blocked_task_ids.join(
                ", ",
              )}`,
            );
          }
          dispatchedTaskIds = [...qualityGate.allowed_task_ids];
          if (dispatchedTaskIds.length > 0) {
            await host.dispatchTaskNerveTasks({
              repoRoot: syncOptions.repoRoot,
              task_ids: dispatchedTaskIds,
            });
          }
        }

        invalidateProjectCiFailureCache(syncOptions.repoRoot);

        return {
          integration_mode: "codex-native-host",
          before: context.snapshot,
          settings: settingsAfterSync,
          persisted_task_upserts: persistedTaskUpserts,
          dispatched_task_ids: dispatchedTaskIds,
          warnings,
        };
      })();

      if (!dedupeEligible) {
        return run;
      }
      projectCiSyncInflight.set(dedupeKey, run);
      try {
        return await run;
      } finally {
        projectCiSyncInflight.delete(dedupeKey);
      }
    },

    syncProjectTrace: async (traceOptions) => {
      return syncProjectTraceSafe(traceOptions);
    },

    syncAgentWatchdog: async (watchdogOptions) => {
      const settings = watchdogOptions.settings
        ? taskNerve.normalizeProjectSettings(watchdogOptions.settings)
        : await taskNerve.loadProjectSettings({
            repoRoot: watchdogOptions.repoRoot,
          });
      return runCodexAgentWatchdog(
        {
          host,
          taskNerve,
        },
        {
          repoRoot: watchdogOptions.repoRoot,
          projectName: watchdogOptions.projectName ?? null,
          tasks: watchdogOptions.tasks,
          settings,
          threadsPayload: watchdogOptions.threadsPayload,
          nowIsoUtc: watchdogOptions.nowIsoUtc,
          policy: watchdogOptions.policy,
        },
      );
    },

    projectProductionSnapshot: async (projectOptions) => {
      const context = await loadCodexProjectProductionContext(
        {
          taskNerve,
          loadProjectGitState,
          loadProjectCiFailures,
          loadProjectCiAgentIds,
        },
        projectOptions,
      );
      return context.snapshot;
    },

    syncProjectProduction: async (syncOptions) => {
      const repoKey = syncOptions.repoRoot.trim();
      const dedupeKey = repoKey
        ? `${repoKey}::${syncTaskMarker(syncOptions.tasks)}::${syncOptions.mode ?? "smart"}`
        : "";
      const dedupeEligible =
        !!repoKey &&
        (syncOptions.mode === undefined || syncOptions.mode === "smart") &&
        syncOptions.autostash !== false &&
        syncOptions.forcePush !== true &&
        syncOptions.autoSwitchPreferredBranch !== false &&
        syncOptions.persistCiTasks !== false &&
        syncOptions.dispatchCiTasks !== false &&
        syncOptions.gitState === undefined &&
        syncOptions.ciFailures === undefined &&
        syncOptions.availableAgentIds === undefined;
      if (dedupeEligible) {
        const inflight = projectProductionSyncInflight.get(dedupeKey);
        if (inflight) {
          return inflight;
        }
      }

      const run = (async () => {
        const productionResult = await syncCodexProjectProduction(
          {
            host,
            taskNerve,
            loadProjectGitState,
            loadProjectCiFailures,
            loadProjectCiAgentIds,
            invalidateProjectGitStateCache,
            invalidateProjectCiFailureCache,
          },
          syncOptions,
        );
        const traceSync = await syncProjectTraceSafe({
          repoRoot: syncOptions.repoRoot,
          nowIsoUtc: syncOptions.nowIsoUtc,
        });
        return {
          ...productionResult,
          trace_sync: traceSync,
          warnings: [...new Set([...productionResult.warnings, ...traceSync.warnings])],
        };
      })();

      if (!dedupeEligible) {
        return run;
      }
      projectProductionSyncInflight.set(dedupeKey, run);
      try {
        return await run;
      } finally {
        projectProductionSyncInflight.delete(dedupeKey);
      }
    },

    controllerProjectAutomation: async (automationOptions) => {
      const repoKey = automationOptions.repoRoot.trim();
      const dedupeKey = repoKey
        ? `${repoKey}::${syncTaskMarker(automationOptions.tasks)}::${String(
            automationOptions.gitOriginUrl || "",
          ).trim()}`
        : "";
      if (repoKey) {
        const inflight = controllerProjectAutomationInflight.get(dedupeKey);
        if (inflight) {
          return inflight;
        }
      }

      const run = (async () => {
        const automationResult = await runCodexControllerProjectAutomation(
          {
            host,
            taskNerve,
            loadProjectGitState,
            loadProjectCiFailures,
            loadProjectCiAgentIds,
            invalidateProjectGitStateCache,
            invalidateProjectCiFailureCache,
          },
          automationOptions,
        );
        const traceSync = await syncProjectTraceSafe({
          repoRoot: automationOptions.repoRoot,
          nowIsoUtc: automationOptions.nowIsoUtc,
        });
        return {
          ...automationResult,
          trace_sync: traceSync,
          warnings: [...new Set([...automationResult.warnings, ...traceSync.warnings])],
        };
      })();

      if (!repoKey) {
        return run;
      }
      controllerProjectAutomationInflight.set(dedupeKey, run);
      try {
        return await run;
      } finally {
        controllerProjectAutomationInflight.delete(dedupeKey);
      }
    },

    bootstrapControllerThread: async (bootstrapOptions) => {
      const settings = await taskNerve.loadProjectSettings({
        repoRoot: bootstrapOptions.repoRoot,
      });
      const controllerModel = taskNerve.resolveModelsForTask(settings).controller_model;
      const prompt = taskNerve.buildControllerPrompt({
        projectName: bootstrapOptions.projectName,
        repoRoot: bootstrapOptions.repoRoot,
        projectGoalsPath: bootstrapOptions.projectGoalsPath,
        projectManifestPath: bootstrapOptions.projectManifestPath,
        currentStateSignals: bootstrapOptions.currentStateSignals,
        timelineSignals: bootstrapOptions.timelineSignals,
        queueSummary: bootstrapOptions.queueSummary,
        maintenanceCadence: bootstrapOptions.maintenanceCadence,
        heartbeatCore: bootstrapOptions.heartbeatCore,
        lowQueuePrompt: bootstrapOptions.lowQueuePrompt,
      });

      const title =
        bootstrapOptions.threadTitle?.trim() || `${bootstrapOptions.projectName} TaskNerve Controller`;

      const threadPayload = await host.startThread({
        title,
        role: "controller",
        agent_id: CONTROLLER_AGENT_ID,
        metadata: {
          source: "tasknerve.codex-native-host-runtime",
          repo_root: bootstrapOptions.repoRoot,
          project_name: bootstrapOptions.projectName,
        },
      });
      const threadId = parseThreadId(threadPayload);
      if (!threadId) {
        throw new Error("Codex host startThread did not return a thread identifier");
      }

      const beforeTurnOps: Array<Promise<unknown> | unknown> = [host.setThreadName(threadId, title)];
      if (controllerModel) {
        beforeTurnOps.push(host.setThreadModel(threadId, controllerModel));
      }
      await Promise.all(beforeTurnOps);
      const turnPayload = {
        thread_id: threadId,
        threadId,
        agent_id: CONTROLLER_AGENT_ID,
        model: controllerModel || undefined,
        prompt,
      };
      const transportExecution = await startTurnWithResolvedModelTransport(
        host,
        turnPayload,
        runtimeEnv,
        {
          requestedMode: runtimeModelTransportMode,
        },
      );
      await Promise.all([host.pinThread(threadId), host.openThread(threadId)]);

      return {
        integration_mode: "codex-native-host",
        thread_id: threadId,
        thread_title: title,
        controller_model: controllerModel,
        prompt,
        model_transport: {
          requested_mode: transportExecution.plan.requested_mode,
          resolved_mode: transportExecution.plan.resolved_mode,
          executed_mode: transportExecution.executed_mode,
          websocket_available: transportExecution.plan.websocket_available,
          fallback_reason: transportExecution.plan.fallback_reason,
          fell_back_to_http: transportExecution.fell_back_to_http,
          websocket_error: transportExecution.websocket_error,
        },
      };
    },

    threadDisplaySnapshot: async (displayOptions) => {
      return taskNerve.threadDisplaySnapshot(displayOptions);
    },

    conversationDisplaySnapshot: async (displayOptions) => {
      return taskNerve.conversationDisplaySnapshot(displayOptions);
    },

    conversationInteractionStep: async (input) => {
      return taskNerve.conversationInteractionStep(input);
    },

    applyConversationInteraction: async (input) => {
      const interaction = taskNerve.conversationInteractionStep(input);
      let applied = 0;
      for (const command of interaction.commands) {
        if (await applyConversationInteractionCommand(command)) {
          applied += 1;
        }
      }
      return {
        ...interaction,
        apply_summary: {
          applied,
          skipped: interaction.commands.length - applied,
        },
      };
    },

    conversationChromeSnapshot: async (stateInput = {}) => {
      const effectiveStateInput = mergedConversationChromeStateInput(stateInput);
      if (hasConversationChromeOverrides(stateInput)) {
        return loadConversationChromeSnapshot(effectiveStateInput);
      }
      const now = Date.now();
      if (
        conversationChromeSnapshotCache &&
        now - conversationChromeSnapshotCache.fetchedAtMs < CONVERSATION_CHROME_CACHE_TTL_MS
      ) {
        return conversationChromeSnapshotCache.snapshot;
      }
      if (conversationChromeSnapshotInflight) {
        return conversationChromeSnapshotInflight;
      }
      conversationChromeSnapshotInflight = loadConversationChromeSnapshot(effectiveStateInput)
        .then((snapshot) => {
          conversationChromeSnapshotCache = {
            snapshot,
            fetchedAtMs: Date.now(),
          };
          return snapshot;
        })
        .finally(() => {
          conversationChromeSnapshotInflight = null;
        });
      return conversationChromeSnapshotInflight;
    },

    handleConversationChromeAction: async (action) => {
      switch (action.type) {
        case "topbar-task-count-click": {
          if (typeof host.openTaskDrawer !== "function") {
            return {
              ok: false,
              integration_mode: "codex-native-host",
              action: action.type,
              error: "Codex host method openTaskDrawer is unavailable",
            };
          }
          await host.openTaskDrawer();
          applyConversationChromeEventPatch({ taskDrawerOpen: true });
          return {
            ok: true,
            integration_mode: "codex-native-host",
            action: action.type,
            task_drawer_open: true,
          };
        }

        case "topbar-import-project-click":
        case "topbar-new-project-click": {
          if (typeof host.addWorkspaceRootOption !== "function") {
            return {
              ok: false,
              integration_mode: "codex-native-host",
              action: action.type,
              error: "Codex host method addWorkspaceRootOption is unavailable",
            };
          }
          await host.addWorkspaceRootOption({
            mode: action.type === "topbar-import-project-click" ? "import-existing" : "new-project",
          });
          return {
            ok: true,
            integration_mode: "codex-native-host",
            action: action.type,
          };
        }

        case "footer-terminal-toggle-click": {
          if (typeof host.toggleTerminalPanel !== "function") {
            return {
              ok: false,
              integration_mode: "codex-native-host",
              action: action.type,
              error: "Codex host method toggleTerminalPanel is unavailable",
            };
          }
          await host.toggleTerminalPanel();
          const terminalOpen = await loadTerminalOpen(undefined, { forceRefresh: true });
          applyConversationChromeEventPatch({ terminalOpen });
          return {
            ok: true,
            integration_mode: "codex-native-host",
            action: action.type,
            terminal_open: terminalOpen,
          };
        }

        case "footer-branch-switch": {
          const branch = action.branch.trim();
          if (!branch) {
            return {
              ok: false,
              integration_mode: "codex-native-host",
              action: action.type,
              error: "Branch name is required",
            };
          }
          if (typeof host.switchTaskNerveBranch !== "function") {
            return {
              ok: false,
              integration_mode: "codex-native-host",
              action: action.type,
              error: "Codex host method switchTaskNerveBranch is unavailable",
            };
          }
          await host.switchTaskNerveBranch(branch);
          const branches = conversationChromeEventState.branches;
          applyConversationChromeEventPatch({
            currentBranch: branch,
            branches:
              branches && branches.length > 0
                ? [branch, ...branches.filter((entry) => entry !== branch)]
                : undefined,
          });
          return {
            ok: true,
            integration_mode: "codex-native-host",
            action: action.type,
            branch,
          };
        }

      }

      const exhaustive: never = action;
      throw new Error(`Unsupported conversation chrome action: ${String(exhaustive)}`);
    },

    observeThreadRefresh: async (observeOptions) => {
      return subscribeWithFallback({
        subscribe: host.subscribeThreadEvents,
        // Thread events can be very chatty; avoid forcing chrome re-reads unless
        // callers explicitly request snapshots after the short TTL window.
        listener: (event) => {
          observeOptions.onEvent(event);
        },
        subscribeArgs: [{ threadId: observeOptions.threadId ?? null }],
        onFallbackRefresh: observeOptions.onFallbackRefresh,
      });
    },

    observeRepositorySettingsRefresh: async (observeOptions) => {
      return subscribeWithFallback({
        subscribe: host.subscribeRepositorySettingsEvents,
        listener: (event) => {
          invalidateConversationChromeCache({ clearReadCaches: true });
          observeOptions.onEvent(event);
        },
        onFallbackRefresh: observeOptions.onFallbackRefresh
          ? () => {
              invalidateConversationChromeCache({ clearReadCaches: true });
              observeOptions.onFallbackRefresh?.();
            }
          : undefined,
      });
    },

    observeConversationChromeRefresh: async (observeOptions) => {
      const disposers = (
        await Promise.all([
          subscribeOptional({
            subscribe: host.subscribeTaskNerveTaskCountEvents,
            listener: (event) => {
              const taskCount = parseTaskCountMaybe(event);
              if (taskCount === null) {
                observeOptions.onEvent({ source: "task-count", payload: event });
                return;
              }
              if (applyConversationChromeEventPatch({ taskCount })) {
                observeOptions.onEvent({ source: "task-count", payload: event });
              }
            },
          }),
          subscribeOptional({
            subscribe: host.subscribeTaskDrawerStateEvents,
            listener: (event) => {
              const taskDrawerOpen = parseOpenStateMaybe(event);
              if (taskDrawerOpen === null) {
                observeOptions.onEvent({ source: "task-drawer", payload: event });
                return;
              }
              if (applyConversationChromeEventPatch({ taskDrawerOpen })) {
                observeOptions.onEvent({ source: "task-drawer", payload: event });
              }
            },
          }),
          subscribeOptional({
            subscribe: host.subscribeTerminalPanelStateEvents,
            listener: (event) => {
              const terminalOpen = parseOpenStateMaybe(event);
              if (terminalOpen === null) {
                observeOptions.onEvent({ source: "terminal-panel", payload: event });
                return;
              }
              if (applyConversationChromeEventPatch({ terminalOpen })) {
                observeOptions.onEvent({ source: "terminal-panel", payload: event });
              }
            },
          }),
          subscribeOptional({
            subscribe: host.subscribeTaskNerveBranchEvents,
            listener: (event) => {
              const branchPatch = parseBranchStatePatch(event);
              if (!branchPatch) {
                observeOptions.onEvent({ source: "branch-state", payload: event });
                return;
              }
              if (
                applyConversationChromeEventPatch({
                  currentBranch: branchPatch.currentBranch,
                  branches: branchPatch.branches,
                })
              ) {
                observeOptions.onEvent({ source: "branch-state", payload: event });
              }
            },
          }),
          subscribeOptional({
            subscribe: host.subscribeTaskNerveResourceStatsEvents,
            listener: (event) => {
              const resourceStats = parseResourceStatsPatch(event);
              if (!resourceStats) {
                observeOptions.onEvent({ source: "resource-stats", payload: event });
                return;
              }
              if (applyConversationChromeEventPatch({ resourceStats })) {
                observeOptions.onEvent({ source: "resource-stats", payload: event });
              }
            },
          }),
        ])
      ).filter((disposer): disposer is () => void => typeof disposer === "function");

      if (disposers.length === 0) {
        observeOptions.onFallbackRefresh?.();
        return {
          mode: "fallback-manual-refresh",
          dispose: () => {},
        };
      }

      return {
        mode: "host-event-subscription",
        dispose: () => {
          disposers.forEach((disposer) => {
            disposer();
          });
        },
      };
    },
  };
}
