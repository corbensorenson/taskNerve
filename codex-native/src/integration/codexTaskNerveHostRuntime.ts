import { CONTROLLER_AGENT_ID } from "../constants.js";
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
import { createTaskNerveService, type TaskNerveService } from "./taskNerveService.js";
import type {
  BuildThreadDisplayOptions,
  ThreadDisplaySnapshot,
} from "./threadDisplay/index.js";

const HOST_STYLING_CONTEXT_CACHE_TTL_MS = 10_000;
const CONVERSATION_CHROME_CACHE_TTL_MS = 250;
const CHROME_STATE_CACHE_TTL_MS = 1_000;
const RESOURCE_STATS_CACHE_TTL_MS = 1_000;
const PROJECT_GIT_STATE_CACHE_TTL_MS = 2_500;
const PROJECT_CI_FAILURE_CACHE_TTL_MS = 7_500;
const PROJECT_CI_AGENT_CACHE_TTL_MS = 2_500;
const PROJECT_STATE_CACHE_MAX_ENTRIES = 256;
const PROJECT_CI_FAILURE_FETCH_LIMIT = 256;

export interface CodexTaskNerveSnapshotOptions {
  repoRoot: string;
  projectName: string;
  tasks: Partial<TaskRecord>[];
  search?: string;
  gitOriginUrl?: string | null;
}

export interface CodexTaskNerveSnapshot {
  integration_mode: "codex-native-host";
  styling: {
    inherit_codex_host: true;
    render_mode: "host-components-only";
  };
  host_styling_context: unknown;
  project_name: string;
  repo_root: string;
  settings: ProjectCodexSettings;
  task_snapshot: ReturnType<TaskNerveService["taskSnapshot"]>;
}

export interface CodexControllerBootstrapOptions {
  repoRoot: string;
  projectName: string;
  projectGoalsPath?: string;
  projectManifestPath?: string;
  currentStateSignals?: string[];
  timelineSignals?: string[];
  queueSummary?: string;
  maintenanceCadence?: string;
  heartbeatCore?: string | null;
  lowQueuePrompt?: string;
  threadTitle?: string;
}

export interface CodexControllerBootstrapResult {
  integration_mode: "codex-native-host";
  thread_id: string;
  thread_title: string;
  controller_model: string | null;
  prompt: string;
}

export interface CodexProjectGitSyncSnapshotOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  nowIsoUtc?: string | null;
  gitState?: unknown;
}

export interface CodexProjectGitSyncRunOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  mode?: "smart" | "pull" | "push";
  autostash?: boolean;
  force?: boolean;
  nowIsoUtc?: string | null;
}

export interface CodexProjectGitSyncRunResult {
  integration_mode: "codex-native-host";
  mode: "smart" | "pull" | "push";
  executed: {
    pull: boolean;
    push: boolean;
  };
  plan_reason: ReturnType<typeof planCodexProjectGitSync>["reason"];
  before: ProjectGitSyncSnapshot;
  after: ProjectGitSyncSnapshot;
  warnings: string[];
}

export interface CodexProjectCiSyncSnapshotOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  ciFailures?: unknown;
  availableAgentIds?: string[];
  nowIsoUtc?: string | null;
}

export interface CodexProjectCiSyncRunOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  ciFailures?: unknown;
  availableAgentIds?: string[];
  persistTasks?: boolean;
  dispatch?: boolean;
  nowIsoUtc?: string | null;
}

export interface CodexProjectCiSyncRunResult {
  integration_mode: "codex-native-host";
  before: ProjectCiTaskSyncPlan;
  settings: ProjectCodexSettings;
  persisted_task_upserts: number;
  dispatched_task_ids: string[];
  warnings: string[];
}

export type CodexConversationChromeAction =
  | { type: "topbar-task-count-click" }
  | { type: "footer-terminal-toggle-click" }
  | { type: "footer-branch-switch"; branch: string };

export interface CodexConversationChromeActionResult {
  ok: boolean;
  integration_mode: "codex-native-host";
  action: CodexConversationChromeAction["type"];
  task_drawer_open?: boolean;
  terminal_open?: boolean;
  branch?: string;
  error?: string;
}

export interface CodexHostRefreshSubscription {
  mode: "host-event-subscription" | "fallback-manual-refresh";
  dispose: () => void;
}

export interface ObserveThreadRefreshOptions {
  threadId?: string | null;
  onEvent: (event: unknown) => void;
  onFallbackRefresh?: () => void;
}

export interface ObserveRepositorySettingsRefreshOptions {
  onEvent: (event: unknown) => void;
  onFallbackRefresh?: () => void;
}

export type CodexConversationChromeRefreshSource =
  | "task-count"
  | "task-drawer"
  | "terminal-panel"
  | "branch-state"
  | "resource-stats";

export interface CodexConversationChromeRefreshEvent {
  source: CodexConversationChromeRefreshSource;
  payload: unknown;
}

export interface ObserveConversationChromeRefreshOptions {
  onEvent: (event: CodexConversationChromeRefreshEvent) => void;
  onFallbackRefresh?: () => void;
}

export interface CodexTaskNerveHostRuntime {
  snapshot: (options: CodexTaskNerveSnapshotOptions) => Promise<CodexTaskNerveSnapshot>;
  bootstrapControllerThread: (
    options: CodexControllerBootstrapOptions,
  ) => Promise<CodexControllerBootstrapResult>;
  projectGitSyncSnapshot: (
    options: CodexProjectGitSyncSnapshotOptions,
  ) => Promise<ProjectGitSyncSnapshot>;
  syncProjectGit: (options: CodexProjectGitSyncRunOptions) => Promise<CodexProjectGitSyncRunResult>;
  projectCiSyncSnapshot: (
    options: CodexProjectCiSyncSnapshotOptions,
  ) => Promise<ProjectCiTaskSyncPlan>;
  syncProjectCi: (options: CodexProjectCiSyncRunOptions) => Promise<CodexProjectCiSyncRunResult>;
  conversationDisplaySnapshot: (
    options: CodexConversationDisplayOptions,
  ) => Promise<CodexConversationDisplaySnapshot>;
  conversationInteractionStep: (
    input: CodexConversationInteractionInput,
  ) => Promise<CodexConversationInteractionResult>;
  applyConversationInteraction: (
    input: CodexConversationInteractionInput,
  ) => Promise<
    CodexConversationInteractionResult & {
      apply_summary: {
        applied: number;
        skipped: number;
      };
    }
  >;
  threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => Promise<ThreadDisplaySnapshot>;
  conversationChromeSnapshot: (
    options?: CodexConversationChromeStateInput,
  ) => Promise<CodexConversationChromeSnapshot>;
  handleConversationChromeAction: (
    action: CodexConversationChromeAction,
  ) => Promise<CodexConversationChromeActionResult>;
  observeThreadRefresh: (
    options: ObserveThreadRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
  observeRepositorySettingsRefresh: (
    options: ObserveRepositorySettingsRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
  observeConversationChromeRefresh: (
    options: ObserveConversationChromeRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
}

interface NormalizedBranchState {
  currentBranch: string | null;
  branches: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseThreadId(value: unknown): string | null {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }
  const direct = payload.thread_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const camel = payload.threadId;
  if (typeof camel === "string" && camel.trim()) {
    return camel;
  }
  const nested = asRecord(payload.thread);
  if (nested) {
    if (typeof nested.id === "string" && nested.id.trim()) {
      return nested.id;
    }
    if (typeof nested.thread_id === "string" && nested.thread_id.trim()) {
      return nested.thread_id;
    }
  }
  const id = payload.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function parseTaskCount(value: unknown): number {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.round(Number(value)));
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  const candidates = [
    record.taskCount,
    record.task_count,
    record.pendingTaskCount,
    record.pending_task_count,
    record.count,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return Math.max(0, Math.round(Number(candidate)));
    }
  }
  return 0;
}

function parseTaskCountMaybe(value: unknown): number | null {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.round(Number(value)));
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const candidates = [
    record.taskCount,
    record.task_count,
    record.pendingTaskCount,
    record.pending_task_count,
    record.count,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return Math.max(0, Math.round(Number(candidate)));
    }
  }
  return null;
}

function parseOpenState(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return fallback;
  }
  const candidates = [record.open, record.isOpen, record.drawer_open, record.task_drawer_open];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return fallback;
}

function parseOpenStateMaybe(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const candidates = [record.open, record.isOpen, record.drawer_open, record.task_drawer_open];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return null;
}

function parseBranchState(value: unknown): NormalizedBranchState {
  if (Array.isArray(value)) {
    const branches = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return {
      currentBranch: branches[0] || null,
      branches,
    };
  }

  const record = asRecord(value);
  if (!record) {
    return { currentBranch: null, branches: [] };
  }

  const rawBranches = Array.isArray(record.branches)
    ? record.branches
    : Array.isArray(record.branchNames)
      ? record.branchNames
      : [];
  const branches = rawBranches
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  const currentCandidates = [
    record.current,
    record.currentBranch,
    record.current_branch,
    record.activeBranch,
    record.active_branch,
  ];
  const currentBranch =
    currentCandidates.find((entry) => typeof entry === "string" && entry.trim()) as
      | string
      | undefined;

  return {
    currentBranch: currentBranch?.trim() || branches[0] || null,
    branches,
  };
}

function parseBranchStatePatch(value: unknown): Partial<NormalizedBranchState> | null {
  if (Array.isArray(value)) {
    const branches = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return {
      currentBranch: branches[0] || null,
      branches,
    };
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  let branches: string[] | undefined;
  if (Array.isArray(record.branches)) {
    branches = record.branches
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } else if (Array.isArray(record.branchNames)) {
    branches = record.branchNames
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  let currentBranch: string | null | undefined;
  const currentCandidates = [
    record.current,
    record.currentBranch,
    record.current_branch,
    record.activeBranch,
    record.active_branch,
  ];
  for (const candidate of currentCandidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      currentBranch = normalized || null;
      break;
    }
  }

  if (branches === undefined && currentBranch === undefined) {
    return null;
  }

  const patch: Partial<NormalizedBranchState> = {};
  if (branches !== undefined) {
    patch.branches = branches;
    if (currentBranch === undefined) {
      patch.currentBranch = branches[0] || null;
    }
  }
  if (currentBranch !== undefined) {
    patch.currentBranch = currentBranch;
  }
  return patch;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function parseAgentIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return parseStringArray(value);
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const candidateArrays = [record.agent_ids, record.agentIds, record.agents, record.workers];
  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    const normalized = candidate
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        const asEntryRecord = asRecord(entry);
        if (!asEntryRecord) {
          return "";
        }
        const idCandidates = [asEntryRecord.id, asEntryRecord.agent_id, asEntryRecord.agentId];
        for (const id of idCandidates) {
          if (typeof id === "string" && id.trim()) {
            return id.trim();
          }
        }
        return "";
      })
      .filter(Boolean);
    if (normalized.length > 0) {
      return [...new Set(normalized)];
    }
  }

  return [];
}

function parseResourceStats(value: unknown): Partial<CodexConversationChromeResourceStats> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    cpuPercent: Number.isFinite(record.cpuPercent)
      ? Number(record.cpuPercent)
      : Number.isFinite(record.cpu_percent)
        ? Number(record.cpu_percent)
        : null,
    gpuPercent: Number.isFinite(record.gpuPercent)
      ? Number(record.gpuPercent)
      : Number.isFinite(record.gpu_percent)
        ? Number(record.gpu_percent)
        : null,
    memoryPercent: Number.isFinite(record.memoryPercent)
      ? Number(record.memoryPercent)
      : Number.isFinite(record.memory_percent)
        ? Number(record.memory_percent)
        : null,
    thermalPressure:
      typeof record.thermalPressure === "string" && record.thermalPressure.trim()
        ? record.thermalPressure.trim()
        : typeof record.thermal_pressure === "string" && record.thermal_pressure.trim()
          ? record.thermal_pressure.trim()
          : null,
    capturedAtUtc:
      typeof record.capturedAtUtc === "string" && record.capturedAtUtc.trim()
        ? record.capturedAtUtc.trim()
        : typeof record.captured_at_utc === "string" && record.captured_at_utc.trim()
          ? record.captured_at_utc.trim()
          : null,
  };
}

function parseResourceStatsPatch(
  value: unknown,
): Partial<CodexConversationChromeResourceStats> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const patch: Partial<CodexConversationChromeResourceStats> = {};

  if ("cpuPercent" in record || "cpu_percent" in record) {
    const candidate = record.cpuPercent ?? record.cpu_percent;
    patch.cpuPercent = Number.isFinite(candidate) ? Number(candidate) : null;
  }
  if ("gpuPercent" in record || "gpu_percent" in record) {
    const candidate = record.gpuPercent ?? record.gpu_percent;
    patch.gpuPercent = Number.isFinite(candidate) ? Number(candidate) : null;
  }
  if ("memoryPercent" in record || "memory_percent" in record) {
    const candidate = record.memoryPercent ?? record.memory_percent;
    patch.memoryPercent = Number.isFinite(candidate) ? Number(candidate) : null;
  }
  if ("thermalPressure" in record || "thermal_pressure" in record) {
    const candidate = record.thermalPressure ?? record.thermal_pressure;
    patch.thermalPressure =
      typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  }
  if ("capturedAtUtc" in record || "captured_at_utc" in record) {
    const candidate = record.capturedAtUtc ?? record.captured_at_utc;
    patch.capturedAtUtc = typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return !left && !right;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function sameResourceStats(
  left: Partial<CodexConversationChromeResourceStats> | null | undefined,
  right: Partial<CodexConversationChromeResourceStats> | null | undefined,
): boolean {
  return (
    (left?.cpuPercent ?? undefined) === (right?.cpuPercent ?? undefined) &&
    (left?.gpuPercent ?? undefined) === (right?.gpuPercent ?? undefined) &&
    (left?.memoryPercent ?? undefined) === (right?.memoryPercent ?? undefined) &&
    (left?.thermalPressure ?? undefined) === (right?.thermalPressure ?? undefined) &&
    (left?.capturedAtUtc ?? undefined) === (right?.capturedAtUtc ?? undefined)
  );
}

function normalizeHostSubscriptionDisposer(value: CodexHostSubscription | void): () => void {
  if (typeof value === "function") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return () => {};
  }
  if ("dispose" in value && typeof value.dispose === "function") {
    return () => value.dispose();
  }
  if ("unsubscribe" in value && typeof value.unsubscribe === "function") {
    return () => value.unsubscribe();
  }
  return () => {};
}

function hasConversationChromeOverrides(input: CodexConversationChromeStateInput): boolean {
  return (
    input.taskCount !== undefined ||
    input.taskDrawerOpen !== undefined ||
    input.terminalOpen !== undefined ||
    input.currentBranch !== undefined ||
    input.branches !== undefined ||
    input.resourceStats !== undefined
  );
}

function getCachedMapValue<Key, Value>(map: Map<Key, Value>, key: Key): Value | null {
  if (!map.has(key)) {
    return null;
  }
  const value = map.get(key)!;
  // Promote the accessed key to keep active repos hot under bounded cache limits.
  map.delete(key);
  map.set(key, value);
  return value;
}

function rememberBoundedMapValue<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
  limit: number,
) {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  if (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
}

export function createCodexTaskNerveHostRuntime(options: {
  host: Partial<CodexHostServices> | null | undefined;
  taskNerveService?: TaskNerveService;
}): CodexTaskNerveHostRuntime {
  const host = assertCodexHostServices(options.host);
  const taskNerve = options.taskNerveService ?? createTaskNerveService();
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
  const projectCiFailureCache = new Map<
    string,
    {
      value: unknown;
      fetchedAtMs: number;
    }
  >();
  const projectCiFailureInflight = new Map<string, Promise<unknown>>();
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
  }> {
    const settings = await taskNerve.loadProjectSettings({
      repoRoot: options.repoRoot,
    });

    let availableAgentIds = parseStringArray(options.availableAgentIds);
    if (availableAgentIds.length === 0 && typeof host.listTaskNerveAgents === "function") {
      const now = Date.now();
      if (projectCiAgentCache && now - projectCiAgentCache.fetchedAtMs < PROJECT_CI_AGENT_CACHE_TTL_MS) {
        availableAgentIds = projectCiAgentCache.value;
      } else {
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
      }
    }

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
      const context = await loadProjectGitSyncContext({
        repoRoot: syncOptions.repoRoot,
        tasks: syncOptions.tasks,
        nowIsoUtc: syncOptions.nowIsoUtc,
      });
      const plan = planCodexProjectGitSync({
        mode: syncOptions.mode,
        snapshot: context.snapshot,
      });
      const warnings: string[] = [];
      let pulled = false;
      let pushed = false;
      let effectiveSettings = context.settings;

      if (plan.should_pull) {
        if (typeof host.pullRepository !== "function") {
          warnings.push("Codex host method pullRepository is unavailable");
        } else {
          await host.pullRepository({
            repoRoot: syncOptions.repoRoot,
            autostash: syncOptions.autostash ?? true,
          });
          pulled = true;
          invalidateProjectGitStateCache(syncOptions.repoRoot);
        }
      }

      const pushBlockedReason = context.snapshot.recommendation.push_blocked_reason;
      const ignoreInsufficientVolumeBlock =
        plan.mode !== "smart" && pushBlockedReason === "insufficient-task-volume";
      const hardBlockedByPolicy =
        plan.should_push &&
        pushBlockedReason !== null &&
        !ignoreInsufficientVolumeBlock &&
        syncOptions.force !== true;

      if (hardBlockedByPolicy) {
        warnings.push(`Push skipped: ${pushBlockedReason}`);
      } else if (plan.should_push) {
        if (typeof host.pushRepository !== "function") {
          warnings.push("Codex host method pushRepository is unavailable");
        } else {
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
        }
      }

      const afterGitState = await loadProjectGitState(syncOptions.repoRoot);
      const after = taskNerve.projectGitSyncSnapshot({
        settings: effectiveSettings,
        tasks: syncOptions.tasks,
        git_state: afterGitState,
        now_iso: syncOptions.nowIsoUtc ?? undefined,
      });

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
        dispatchedTaskIds = [...context.snapshot.dispatch_task_ids];
        await host.dispatchTaskNerveTasks({
          repoRoot: syncOptions.repoRoot,
          task_ids: dispatchedTaskIds,
        });
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
      await host.startTurn({
        thread_id: threadId,
        threadId,
        agent_id: CONTROLLER_AGENT_ID,
        model: controllerModel || undefined,
        prompt,
      });
      await Promise.all([host.pinThread(threadId), host.openThread(threadId)]);

      return {
        integration_mode: "codex-native-host",
        thread_id: threadId,
        thread_title: title,
        controller_model: controllerModel,
        prompt,
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
