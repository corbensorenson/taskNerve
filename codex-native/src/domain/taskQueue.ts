import type { PromptQueueRequest, TaskRecord } from "../schemas.js";

const TASK_STATUS_RANK: Record<string, number> = {
  open: 0,
  claimed: 1,
  blocked: 2,
  done: 3,
};

const REQUIRED_TASK_QUALITY_FIELDS = [
  "title",
  "objective",
  "acceptance_criteria",
  "deliverables",
  "verification_steps",
  "files_in_scope",
] as const;

const TASK_QUALITY_REQUIRED_WEIGHTS: Record<(typeof REQUIRED_TASK_QUALITY_FIELDS)[number], number> = {
  title: 15,
  objective: 15,
  acceptance_criteria: 15,
  deliverables: 10,
  verification_steps: 10,
  files_in_scope: 5,
};

const TASK_QUALITY_OPTIONAL_WEIGHTS = {
  task_type: 5,
  estimated_effort: 5,
  implementation_notes: 5,
  risk_notes: 5,
  subsystem: 5,
  ready: 5,
} as const;

const TASK_QUALITY_TOTAL_WEIGHT = 100;

export interface TaskDispatchQualityGate {
  enabled: boolean;
  minScore: number;
  includeCiTasks: boolean;
}

export interface TaskQualityScore {
  task_id: string | null;
  title: string;
  score: number;
  passes: boolean;
  is_ci_task: boolean;
  missing_required_fields: Array<(typeof REQUIRED_TASK_QUALITY_FIELDS)[number]>;
  required_checks: Record<(typeof REQUIRED_TASK_QUALITY_FIELDS)[number], boolean>;
  optional_checks: Record<keyof typeof TASK_QUALITY_OPTIONAL_WEIGHTS, boolean>;
}

export interface TaskDispatchQualityGateResult {
  gate: TaskDispatchQualityGate;
  allowed_task_ids: string[];
  blocked_task_ids: string[];
  scored_tasks: TaskQualityScore[];
}

const DEFAULT_TASK_DISPATCH_QUALITY_GATE: TaskDispatchQualityGate = {
  enabled: true,
  minScore: 80,
  includeCiTasks: false,
};

function normalizeSearchText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStringArray(values: readonly unknown[] | undefined): boolean {
  return Array.isArray(values) && values.some((value) => hasNonEmptyText(value));
}

function normalizeTaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTaskIds(taskIds: readonly string[]): string[] {
  const unique = new Set<string>();
  const normalized: string[] = [];
  for (const taskId of taskIds) {
    const id = normalizeTaskId(taskId);
    if (!id || unique.has(id)) {
      continue;
    }
    unique.add(id);
    normalized.push(id);
  }
  return normalized;
}

function normalizeQualityGate(
  gate: Partial<TaskDispatchQualityGate> | undefined,
): TaskDispatchQualityGate {
  const minScoreRaw =
    typeof gate?.minScore === "number" && Number.isFinite(gate.minScore)
      ? Math.round(gate.minScore)
      : DEFAULT_TASK_DISPATCH_QUALITY_GATE.minScore;
  return {
    enabled:
      typeof gate?.enabled === "boolean" ? gate.enabled : DEFAULT_TASK_DISPATCH_QUALITY_GATE.enabled,
    minScore: Math.max(0, Math.min(100, minScoreRaw)),
    includeCiTasks:
      typeof gate?.includeCiTasks === "boolean"
        ? gate.includeCiTasks
        : DEFAULT_TASK_DISPATCH_QUALITY_GATE.includeCiTasks,
  };
}

export function isCiTask(task: Partial<TaskRecord>): boolean {
  const tags = Array.isArray(task.tags) ? task.tags : [];
  return tags.some((tag) => {
    if (typeof tag !== "string") {
      return false;
    }
    const normalized = tag.trim().toLowerCase();
    return normalized === "ci" || normalized.startsWith("ci-") || normalized.startsWith("ci:");
  });
}

export function scoreTaskQuality(
  task: Partial<TaskRecord>,
  options: { minScore?: number } = {},
): TaskQualityScore {
  const minScoreRaw =
    typeof options.minScore === "number" && Number.isFinite(options.minScore)
      ? Math.round(options.minScore)
      : DEFAULT_TASK_DISPATCH_QUALITY_GATE.minScore;
  const minScore = Math.max(0, Math.min(100, minScoreRaw));
  const requiredChecks: TaskQualityScore["required_checks"] = {
    title: hasNonEmptyText(task.title),
    objective: hasNonEmptyText(task.objective),
    acceptance_criteria: hasNonEmptyStringArray(task.acceptance_criteria),
    deliverables: hasNonEmptyStringArray(task.deliverables),
    verification_steps: hasNonEmptyStringArray(task.verification_steps),
    files_in_scope: hasNonEmptyStringArray(task.files_in_scope),
  };
  const optionalChecks: TaskQualityScore["optional_checks"] = {
    task_type: hasNonEmptyText(task.task_type),
    estimated_effort: hasNonEmptyText(task.estimated_effort),
    implementation_notes: hasNonEmptyText(task.implementation_notes),
    risk_notes: hasNonEmptyStringArray(task.risk_notes),
    subsystem: hasNonEmptyText(task.subsystem),
    ready: task.ready === true,
  };

  let score = 0;
  for (const fieldName of REQUIRED_TASK_QUALITY_FIELDS) {
    if (requiredChecks[fieldName]) {
      score += TASK_QUALITY_REQUIRED_WEIGHTS[fieldName];
    }
  }
  for (const fieldName of Object.keys(TASK_QUALITY_OPTIONAL_WEIGHTS) as Array<
    keyof typeof TASK_QUALITY_OPTIONAL_WEIGHTS
  >) {
    if (optionalChecks[fieldName]) {
      score += TASK_QUALITY_OPTIONAL_WEIGHTS[fieldName];
    }
  }
  score = Math.max(0, Math.min(100, Math.round((score / TASK_QUALITY_TOTAL_WEIGHT) * 100)));

  const missingRequired = REQUIRED_TASK_QUALITY_FIELDS.filter((fieldName) => !requiredChecks[fieldName]);
  return {
    task_id: normalizeTaskId(task.task_id),
    title: hasNonEmptyText(task.title) ? String(task.title).trim() : "",
    score,
    passes: missingRequired.length === 0 && score >= minScore,
    is_ci_task: isCiTask(task),
    missing_required_fields: missingRequired,
    required_checks: requiredChecks,
    optional_checks: optionalChecks,
  };
}

export function gateTaskDispatchByQuality(options: {
  taskIds: readonly string[];
  tasks: readonly Partial<TaskRecord>[];
  gate?: Partial<TaskDispatchQualityGate>;
}): TaskDispatchQualityGateResult {
  const gate = normalizeQualityGate(options.gate);
  const taskMap = new Map<string, Partial<TaskRecord>>();
  for (const task of options.tasks) {
    const taskId = normalizeTaskId(task.task_id);
    if (!taskId || taskMap.has(taskId)) {
      continue;
    }
    taskMap.set(taskId, task);
  }

  const allowedTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const scoredTasks: TaskQualityScore[] = [];
  const normalizedTaskIds = normalizeTaskIds(options.taskIds);

  for (const taskId of normalizedTaskIds) {
    const task = taskMap.get(taskId);
    if (!gate.enabled || !task) {
      allowedTaskIds.push(taskId);
      continue;
    }
    const quality = scoreTaskQuality(task, { minScore: gate.minScore });
    scoredTasks.push(quality);
    if (quality.is_ci_task && !gate.includeCiTasks) {
      allowedTaskIds.push(taskId);
      continue;
    }
    if (quality.passes) {
      allowedTaskIds.push(taskId);
      continue;
    }
    blockedTaskIds.push(taskId);
  }

  return {
    gate,
    allowed_task_ids: allowedTaskIds,
    blocked_task_ids: blockedTaskIds,
    scored_tasks: scoredTasks,
  };
}

function includesNormalizedSearch(value: unknown, normalizedSearch: string): boolean {
  if (!normalizedSearch || typeof value !== "string" || value.length === 0) {
    return false;
  }
  return value.toLowerCase().includes(normalizedSearch);
}

function arrayIncludesNormalizedSearch(
  values: readonly unknown[] | undefined,
  normalizedSearch: string,
): boolean {
  if (!values || values.length === 0) {
    return false;
  }
  for (const value of values) {
    if (includesNormalizedSearch(value, normalizedSearch)) {
      return true;
    }
  }
  return false;
}

export function taskUserTags(task: Partial<TaskRecord>): string[] {
  return (task.tags || []).filter((tag) => {
    return !tag.startsWith("intelligence:") && !tag.startsWith("model:");
  });
}

export function sortTasks(tasks: Partial<TaskRecord>[]): Partial<TaskRecord>[] {
  return [...tasks].sort((left, right) => {
    const leftRank = TASK_STATUS_RANK[left.status || ""] ?? 9;
    const rightRank = TASK_STATUS_RANK[right.status || ""] ?? 9;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

export function filterTasks(
  tasks: Partial<TaskRecord>[],
  search = "",
  options: { alreadySorted?: boolean } = {},
): Partial<TaskRecord>[] {
  const normalizedSearch = normalizeSearchText(search);
  const sorted = options.alreadySorted ? tasks : sortTasks(tasks);
  if (!normalizedSearch) {
    return sorted;
  }
  return sorted.filter((task) => {
    return (
      includesNormalizedSearch(task.task_id, normalizedSearch) ||
      includesNormalizedSearch(task.title, normalizedSearch) ||
      includesNormalizedSearch(task.detail, normalizedSearch) ||
      includesNormalizedSearch(task.objective, normalizedSearch) ||
      includesNormalizedSearch(task.task_type, normalizedSearch) ||
      includesNormalizedSearch(task.subsystem, normalizedSearch) ||
      includesNormalizedSearch(task.implementation_notes, normalizedSearch) ||
      includesNormalizedSearch(task.estimated_effort, normalizedSearch) ||
      includesNormalizedSearch(task.claimed_by_agent_id, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.tags, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.depends_on, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.files_in_scope, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.out_of_scope, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.acceptance_criteria, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.deliverables, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.verification_steps, normalizedSearch) ||
      arrayIncludesNormalizedSearch(task.risk_notes, normalizedSearch)
    );
  });
}

export function buildProjectTaskStats(tasks: Partial<TaskRecord>[]) {
  return tasks.reduce(
    (stats, task) => {
      const status = String(task.status || "open");
      stats.total += 1;
      if (status === "open") {
        stats.open += 1;
      }
      if (status === "claimed") {
        stats.claimed += 1;
      }
      if (status === "blocked") {
        stats.blocked += 1;
      }
      if (status === "done") {
        stats.done += 1;
      }
      if (task.ready) {
        stats.ready += 1;
      }
      return stats;
    },
    { total: 0, open: 0, claimed: 0, blocked: 0, done: 0, ready: 0 },
  );
}

function samePromptTarget(
  left: Partial<PromptQueueRequest>,
  right: Partial<PromptQueueRequest>,
): boolean {
  return left.agent_id === right.agent_id && left.thread_id === right.thread_id;
}

export function mergePromptQueue(
  queue: Partial<PromptQueueRequest>[],
  request: Partial<PromptQueueRequest>,
  options: { singleMessageMode?: boolean } = {},
) {
  const singleMessageMode = options.singleMessageMode ?? true;
  const nextRequest: Partial<PromptQueueRequest> = {
    ...request,
    status: request.status || "pending",
  };
  if (!singleMessageMode) {
    return {
      queue: [...queue, nextRequest],
      replaced_pending: false,
      running_inflight: false,
    };
  }

  let runningInflight = false;
  let replacedPending = false;
  const preserved: Partial<PromptQueueRequest>[] = [];
  for (const entry of queue) {
    const sameTarget = samePromptTarget(entry, nextRequest);
    if (sameTarget && entry.status === "running") {
      runningInflight = true;
    }
    if (sameTarget && entry.status === "pending") {
      replacedPending = true;
      continue;
    }
    preserved.push(entry);
  }

  return {
    queue: [...preserved, nextRequest],
    replaced_pending: replacedPending,
    running_inflight: runningInflight,
  };
}
