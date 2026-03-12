import type { CodexHostSubscription } from "../host/codexHostServices.js";
import type { TaskRecord } from "../schemas.js";
import type {
  CodexConversationChromeResourceStats,
  CodexConversationChromeStateInput,
} from "./codexConversationChrome.js";

export interface NormalizedBranchState {
  currentBranch: string | null;
  branches: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseThreadId(value: unknown): string | null {
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

export function parseTaskCount(value: unknown): number {
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

export function parseTaskCountMaybe(value: unknown): number | null {
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

export function parseOpenState(value: unknown, fallback = false): boolean {
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

export function parseOpenStateMaybe(value: unknown): boolean | null {
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

export function parseBranchState(value: unknown): NormalizedBranchState {
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

export function parseBranchStatePatch(value: unknown): Partial<NormalizedBranchState> | null {
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

export { parseStringArray };

export function syncTaskMarker(tasks: Partial<TaskRecord>[] | undefined): string {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return "0";
  }
  const first = tasks[0] || {};
  const middle = tasks[Math.floor((tasks.length - 1) / 2)] || {};
  const last = tasks[tasks.length - 1] || {};
  const markerFor = (task: Partial<TaskRecord>) =>
    [
      String(task.task_id || "").trim(),
      String(task.status || "").trim(),
      String(task.claimed_by_agent_id || "").trim(),
      String(task.title || "").trim().slice(0, 48),
    ].join(":");
  return [String(tasks.length), markerFor(first), markerFor(middle), markerFor(last)].join("|");
}

export function parseAgentIds(value: unknown): string[] {
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

export function parseResourceStats(value: unknown): Partial<CodexConversationChromeResourceStats> {
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

export function parseResourceStatsPatch(
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
    patch.thermalPressure = typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  }
  if ("capturedAtUtc" in record || "captured_at_utc" in record) {
    const candidate = record.capturedAtUtc ?? record.captured_at_utc;
    patch.capturedAtUtc = typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
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

export function sameResourceStats(
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

export function normalizeHostSubscriptionDisposer(value: CodexHostSubscription | void): () => void {
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

export function hasConversationChromeOverrides(input: CodexConversationChromeStateInput): boolean {
  return (
    input.taskCount !== undefined ||
    input.taskDrawerOpen !== undefined ||
    input.terminalOpen !== undefined ||
    input.currentBranch !== undefined ||
    input.branches !== undefined ||
    input.resourceStats !== undefined
  );
}

export function getCachedMapValue<Key, Value>(map: Map<Key, Value>, key: Key): Value | null {
  if (!map.has(key)) {
    return null;
  }
  const value = map.get(key)!;
  // Promote the accessed key to keep active repos hot under bounded cache limits.
  map.delete(key);
  map.set(key, value);
  return value;
}

export function rememberBoundedMapValue<Key, Value>(
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
