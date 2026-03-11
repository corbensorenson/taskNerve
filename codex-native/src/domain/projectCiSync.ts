import { nowIsoUtc } from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { normalizeProjectCodexSettings } from "./projectCodexSettings.js";

const MAX_FAILURES = 256;
const MAX_AGENTS = 128;

export type ProjectCiFailureStatus = "failed" | "error" | "timed_out" | "cancelled";

export interface ProjectCiFailure {
  provider: string | null;
  pipeline: string | null;
  job: string;
  branch: string | null;
  commit_sha: string | null;
  run_id: string | null;
  run_url: string | null;
  status: ProjectCiFailureStatus;
  summary: string | null;
  detected_at_utc: string | null;
}

export interface BuildProjectCiTaskSyncPlanOptions {
  settings: Partial<ProjectCodexSettings>;
  tasks?: Partial<TaskRecord>[];
  failures?: Partial<ProjectCiFailure>[];
  available_agent_ids?: string[];
  now_iso?: string;
}

export interface ProjectCiFailureRecord extends ProjectCiFailure {
  key: string;
}

export interface ProjectCiTaskUpsert {
  action: "create" | "reopen" | "refresh";
  key: string;
  task: TaskRecord;
}

export interface ProjectCiTaskSyncPlan {
  integration_mode: "codex-native-host";
  generated_at_utc: string;
  policy: {
    auto_task_enabled: boolean;
    failure_task_priority: number;
    default_assignee_agent_id: string | null;
  };
  ci_metrics: {
    failure_count: number;
    unique_failure_count: number;
    task_upsert_count: number;
    newly_created_count: number;
    reopened_count: number;
    refreshed_count: number;
    dispatch_count: number;
  };
  failures: ProjectCiFailureRecord[];
  task_upserts: ProjectCiTaskUpsert[];
  dispatch_task_ids: string[];
}

export interface BuildProjectSettingsAfterCiSyncOptions {
  settings: Partial<ProjectCodexSettings>;
  failed_job_count: number;
  synced_at_utc?: string;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function normalizeInt(value: unknown, fallback = 0, min = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(Number(value)));
}

function normalizeStringArray(value: unknown, limit = 64): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = [
    ...new Set(
      value
        .map((entry) => normalizeOptionalText(entry))
        .filter((entry): entry is string => entry !== null),
    ),
  ];
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(0, limit);
}

function normalizeFailureStatus(value: unknown): ProjectCiFailureStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "failed":
    case "failure":
      return "failed";
    case "error":
    case "errored":
      return "error";
    case "timed_out":
    case "timed out":
    case "timeout":
      return "timed_out";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

function normalizeFailure(input: Partial<ProjectCiFailure>): ProjectCiFailure | null {
  const status = normalizeFailureStatus(input.status);
  const pipeline = normalizeOptionalText(input.pipeline);
  const job = normalizeOptionalText(input.job) || pipeline;
  if (!status || !job) {
    return null;
  }
  return {
    provider: normalizeOptionalText(input.provider),
    pipeline,
    job,
    branch: normalizeOptionalText(input.branch),
    commit_sha: normalizeOptionalText(input.commit_sha),
    run_id: normalizeOptionalText(input.run_id),
    run_url: normalizeOptionalText(input.run_url),
    status,
    summary: normalizeOptionalText(input.summary),
    detected_at_utc: normalizeOptionalText(input.detected_at_utc),
  };
}

function isNewerFailure(candidate: ProjectCiFailure, existing: ProjectCiFailure): boolean {
  const candidateTime = candidate.detected_at_utc ? Date.parse(candidate.detected_at_utc) : Number.NaN;
  const existingTime = existing.detected_at_utc ? Date.parse(existing.detected_at_utc) : Number.NaN;
  const candidateValid = Number.isFinite(candidateTime);
  const existingValid = Number.isFinite(existingTime);
  if (candidateValid && existingValid) {
    return candidateTime >= existingTime;
  }
  if (candidateValid && !existingValid) {
    return true;
  }
  if (!candidateValid && existingValid) {
    return false;
  }
  return (candidate.run_id || "") >= (existing.run_id || "");
}

function buildFailureKey(failure: ProjectCiFailure): string {
  return [
    failure.provider || "unknown-provider",
    failure.pipeline || "unknown-pipeline",
    failure.job,
    failure.branch || "unknown-branch",
  ]
    .map((entry) => entry.toLowerCase())
    .join("::");
}

function parseCiTaskKey(task: Partial<TaskRecord>): string | null {
  if (!Array.isArray(task.tags)) {
    return null;
  }
  for (const tag of task.tags) {
    if (typeof tag === "string" && tag.startsWith("ci-key:")) {
      const key = tag.slice("ci-key:".length).trim().toLowerCase();
      if (key) {
        return key;
      }
    }
  }
  return null;
}

function taskIdHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const normalized = hash >>> 0;
  return normalized.toString(16).padStart(8, "0");
}

function ciTaskIdForKey(key: string): string {
  return `ci-${taskIdHash(key)}`;
}

function sanitizeTagValue(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._:/-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function mergeUniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function buildCiTaskDetail(failure: ProjectCiFailure): string {
  const lines = [
    `CI status: ${failure.status}`,
    `Job: ${failure.job}`,
    `Pipeline: ${failure.pipeline || "unknown"}`,
    `Branch: ${failure.branch || "unknown"}`,
    `Commit: ${failure.commit_sha || "unknown"}`,
  ];
  if (failure.run_id) {
    lines.push(`Run ID: ${failure.run_id}`);
  }
  if (failure.run_url) {
    lines.push(`Run URL: ${failure.run_url}`);
  }
  if (failure.summary) {
    lines.push(`Summary: ${failure.summary}`);
  }
  return lines.join("\n");
}

function buildAgentLoadMap(tasks: Partial<TaskRecord>[], availableAgents: string[]): Map<string, number> {
  const loads = new Map<string, number>();
  for (const agentId of availableAgents) {
    loads.set(agentId, 0);
  }
  for (const task of tasks) {
    const status = task.status;
    if (status === "done") {
      continue;
    }
    const claimedBy = normalizeOptionalText(task.claimed_by_agent_id);
    if (claimedBy && loads.has(claimedBy)) {
      loads.set(claimedBy, (loads.get(claimedBy) || 0) + 1);
    }
  }
  return loads;
}

function selectAssignee(options: {
  preferredAssignee: string | null;
  availableAgents: string[];
  loads: Map<string, number>;
}): string | null {
  if (options.preferredAssignee) {
    return options.preferredAssignee;
  }
  if (options.availableAgents.length === 0) {
    return null;
  }
  let selected: string | null = null;
  let selectedLoad = Number.POSITIVE_INFINITY;
  for (const agentId of options.availableAgents) {
    const load = options.loads.get(agentId) || 0;
    if (selected === null || load < selectedLoad || (load === selectedLoad && agentId < selected)) {
      selected = agentId;
      selectedLoad = load;
    }
  }
  return selected;
}

function normalizeExistingTask(task: Partial<TaskRecord> | undefined, key: string): TaskRecord {
  const taskId = normalizeOptionalText(task?.task_id) || ciTaskIdForKey(key);
  const title = normalizeOptionalText(task?.title) || "Fix CI failure";
  const priority = normalizeInt(task?.priority, 9, 0);
  const status = task?.status === "claimed" || task?.status === "blocked" || task?.status === "done"
    ? task.status
    : "open";

  return {
    task_id: taskId,
    title,
    detail: normalizeOptionalText(task?.detail),
    priority,
    tags: mergeUniqueTags(Array.isArray(task?.tags) ? task.tags : []),
    depends_on: Array.isArray(task?.depends_on)
      ? task.depends_on.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
    status,
    ready: Boolean(task?.ready),
    claimed_by_agent_id: normalizeOptionalText(task?.claimed_by_agent_id),
    suggested_intelligence:
      task?.suggested_intelligence === "low" ||
      task?.suggested_intelligence === "medium" ||
      task?.suggested_intelligence === "high" ||
      task?.suggested_intelligence === "max"
        ? task.suggested_intelligence
        : undefined,
    suggested_model: normalizeOptionalText(task?.suggested_model) ?? undefined,
  };
}

function buildCiTaskFromFailure(options: {
  key: string;
  failure: ProjectCiFailure;
  baseTask?: Partial<TaskRecord>;
  priority: number;
  assignee: string | null;
  forceOpen: boolean;
}): TaskRecord {
  const base = normalizeExistingTask(options.baseTask, options.key);
  const status = options.assignee ? "claimed" : options.forceOpen ? "open" : base.status === "done" ? "open" : base.status;
  return {
    ...base,
    title: `Fix CI failure: ${options.failure.job}${options.failure.branch ? ` (${options.failure.branch})` : ""}`,
    detail: buildCiTaskDetail(options.failure),
    priority: Math.max(base.priority, options.priority),
    status,
    ready: true,
    claimed_by_agent_id: options.assignee,
    suggested_intelligence: "high",
    tags: mergeUniqueTags([
      ...base.tags,
      "ci",
      `ci-key:${options.key}`,
      `ci-provider:${sanitizeTagValue(options.failure.provider, "unknown")}`,
      `ci-pipeline:${sanitizeTagValue(options.failure.pipeline, "unknown")}`,
      `ci-branch:${sanitizeTagValue(options.failure.branch, "unknown")}`,
    ]),
  };
}

export function buildProjectCiTaskSyncPlan(
  options: BuildProjectCiTaskSyncPlanOptions,
): ProjectCiTaskSyncPlan {
  const normalizedSettings = normalizeProjectCodexSettings(options.settings);
  const generatedAtUtc = normalizeOptionalText(options.now_iso) || nowIsoUtc();
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const availableAgents = normalizeStringArray(options.available_agent_ids, MAX_AGENTS);

  const normalizedFailuresRaw = Array.isArray(options.failures) ? options.failures : [];
  const normalizedFailures: ProjectCiFailure[] = [];
  for (let index = 0; index < normalizedFailuresRaw.length; index += 1) {
    if (normalizedFailures.length >= MAX_FAILURES) {
      break;
    }
    const normalized = normalizeFailure(normalizedFailuresRaw[index] || {});
    if (normalized) {
      normalizedFailures.push(normalized);
    }
  }

  const uniqueFailures = new Map<string, ProjectCiFailure>();
  for (const failure of normalizedFailures) {
    const key = buildFailureKey(failure);
    const existing = uniqueFailures.get(key);
    if (!existing || isNewerFailure(failure, existing)) {
      uniqueFailures.set(key, failure);
    }
  }

  const activeTasksByKey = new Map<string, Partial<TaskRecord>>();
  const doneTasksByKey = new Map<string, Partial<TaskRecord>>();
  for (const task of tasks) {
    const key = parseCiTaskKey(task);
    if (!key) {
      continue;
    }
    if (task.status === "done") {
      if (!doneTasksByKey.has(key)) {
        doneTasksByKey.set(key, task);
      }
      continue;
    }
    if (!activeTasksByKey.has(key)) {
      activeTasksByKey.set(key, task);
    }
  }

  const failurePriority = normalizeInt(normalizedSettings.ci_failure_task_priority, 9, 0);
  const preferredAssignee = normalizeOptionalText(normalizedSettings.ci_default_assignee_agent_id);
  const loads = buildAgentLoadMap(tasks, availableAgents);

  const failures: ProjectCiFailureRecord[] = [];
  const taskUpserts: ProjectCiTaskUpsert[] = [];
  const dispatchTaskIds: string[] = [];
  let created = 0;
  let reopened = 0;
  let refreshed = 0;

  for (const [key, failure] of uniqueFailures.entries()) {
    failures.push({
      ...failure,
      key,
    });

    const activeTask = activeTasksByKey.get(key);
    const doneTask = doneTasksByKey.get(key);

    if (activeTask) {
      const previousClaimedBy = normalizeOptionalText(activeTask.claimed_by_agent_id);
      if (previousClaimedBy) {
        continue;
      }
      const assignee = selectAssignee({
        preferredAssignee,
        availableAgents,
        loads,
      });
      if (!assignee) {
        continue;
      }
      const refreshedTask = buildCiTaskFromFailure({
        key,
        failure,
        baseTask: activeTask,
        priority: failurePriority,
        assignee,
        forceOpen: false,
      });
      taskUpserts.push({
        action: "refresh",
        key,
        task: refreshedTask,
      });
      refreshed += 1;
      dispatchTaskIds.push(refreshedTask.task_id);
      loads.set(assignee, (loads.get(assignee) || 0) + 1);
      continue;
    }

    const assignee = selectAssignee({
      preferredAssignee,
      availableAgents,
      loads,
    });

    if (doneTask) {
      const reopenedTask = buildCiTaskFromFailure({
        key,
        failure,
        baseTask: doneTask,
        priority: failurePriority,
        assignee,
        forceOpen: true,
      });
      taskUpserts.push({
        action: "reopen",
        key,
        task: reopenedTask,
      });
      reopened += 1;
      dispatchTaskIds.push(reopenedTask.task_id);
      if (assignee) {
        loads.set(assignee, (loads.get(assignee) || 0) + 1);
      }
      continue;
    }

    const createdTask = buildCiTaskFromFailure({
      key,
      failure,
      priority: failurePriority,
      assignee,
      forceOpen: true,
    });
    taskUpserts.push({
      action: "create",
      key,
      task: createdTask,
    });
    created += 1;
    dispatchTaskIds.push(createdTask.task_id);
    if (assignee) {
      loads.set(assignee, (loads.get(assignee) || 0) + 1);
    }
  }

  return {
    integration_mode: "codex-native-host",
    generated_at_utc: generatedAtUtc,
    policy: {
      auto_task_enabled: Boolean(normalizedSettings.ci_auto_task_enabled),
      failure_task_priority: failurePriority,
      default_assignee_agent_id: preferredAssignee,
    },
    ci_metrics: {
      failure_count: normalizedFailures.length,
      unique_failure_count: failures.length,
      task_upsert_count: taskUpserts.length,
      newly_created_count: created,
      reopened_count: reopened,
      refreshed_count: refreshed,
      dispatch_count: dispatchTaskIds.length,
    },
    failures,
    task_upserts: taskUpserts,
    dispatch_task_ids: dispatchTaskIds,
  };
}

export function buildProjectSettingsAfterCiSync(
  options: BuildProjectSettingsAfterCiSyncOptions,
): ProjectCodexSettings {
  const normalizedSettings = normalizeProjectCodexSettings(options.settings);
  const syncedAtUtc = normalizeOptionalText(options.synced_at_utc) || nowIsoUtc();

  return normalizeProjectCodexSettings({
    ...normalizedSettings,
    ci_last_sync_at_utc: syncedAtUtc,
    ci_last_failed_job_count: normalizeInt(options.failed_job_count, 0, 0),
  });
}
