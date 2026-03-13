import { CONTROLLER_AGENT_ID } from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type { CodexHostServices } from "../host/codexHostServices.js";
import type { TaskNerveService } from "./taskNerveService.js";

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTaskId(value: unknown): string | null {
  return normalizeOptionalText(value);
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

function normalizeTaskStatus(value: unknown): "open" | "claimed" | "blocked" | "done" {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (normalized === "claimed" || normalized === "blocked" || normalized === "done") {
    return normalized;
  }
  return "open";
}

function mergeTaskRecords(
  projectTasks: readonly Partial<TaskRecord>[],
  candidateTasks: readonly Partial<TaskRecord>[],
): Map<string, Partial<TaskRecord>> {
  const byId = new Map<string, Partial<TaskRecord>>();
  for (const task of [...projectTasks, ...candidateTasks]) {
    const taskId = normalizeTaskId(task.task_id);
    if (!taskId) {
      continue;
    }
    byId.set(taskId, task);
  }
  return byId;
}

interface AssignmentGateResult {
  allowed_task_ids: string[];
  blocked_task_ids: string[];
  continue_task_ids: string[];
}

function gateTaskDispatchByAssignment(options: {
  taskIds: readonly string[];
  tasksById: Map<string, Partial<TaskRecord>>;
  projectTasks: readonly Partial<TaskRecord>[];
}): AssignmentGateResult {
  const activeByAgent = new Map<string, string[]>();
  for (const task of options.projectTasks) {
    const taskId = normalizeTaskId(task.task_id);
    if (!taskId) {
      continue;
    }
    const status = normalizeTaskStatus(task.status);
    if (status === "done") {
      continue;
    }
    const agentId = normalizeOptionalText(task.claimed_by_agent_id);
    if (!agentId || agentId === CONTROLLER_AGENT_ID) {
      continue;
    }
    const existing = activeByAgent.get(agentId) ?? [];
    if (!existing.includes(taskId)) {
      existing.push(taskId);
      activeByAgent.set(agentId, existing);
    }
  }

  const allowedTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const continueTaskIds = new Set<string>();
  const dispatchedByAgent = new Map<string, string>();

  for (const taskId of options.taskIds) {
    const task = options.tasksById.get(taskId);
    if (!task) {
      allowedTaskIds.push(taskId);
      continue;
    }
    const agentId = normalizeOptionalText(task.claimed_by_agent_id);
    if (!agentId || agentId === CONTROLLER_AGENT_ID) {
      allowedTaskIds.push(taskId);
      continue;
    }

    const active = activeByAgent.get(agentId) ?? [];
    const blockingExistingTaskId = active.find((activeTaskId) => activeTaskId !== taskId) ?? null;
    if (blockingExistingTaskId) {
      blockedTaskIds.push(taskId);
      continueTaskIds.add(blockingExistingTaskId);
      continue;
    }

    const alreadyDispatchedForAgent = dispatchedByAgent.get(agentId);
    if (alreadyDispatchedForAgent && alreadyDispatchedForAgent !== taskId) {
      blockedTaskIds.push(taskId);
      continueTaskIds.add(alreadyDispatchedForAgent);
      continue;
    }

    allowedTaskIds.push(taskId);
    dispatchedByAgent.set(agentId, taskId);
  }

  return {
    allowed_task_ids: allowedTaskIds,
    blocked_task_ids: blockedTaskIds,
    continue_task_ids: [...continueTaskIds],
  };
}

export interface CodexTaskDispatchRequest {
  host: CodexHostServices;
  taskNerve: TaskNerveService;
  repoRoot: string;
  settings: Partial<ProjectCodexSettings>;
  taskIds: readonly string[];
  projectTasks?: readonly Partial<TaskRecord>[];
  candidateTasks?: readonly Partial<TaskRecord>[];
  label?: string;
}

export interface CodexTaskDispatchResult {
  requested_task_ids: string[];
  dispatched_task_ids: string[];
  blocked_task_ids: string[];
  blocked_by_quality_task_ids: string[];
  blocked_by_assignment_task_ids: string[];
  blocked_missing_task_ids: string[];
  continue_task_ids: string[];
  warnings: string[];
}

function joinTaskIds(taskIds: readonly string[]): string {
  return taskIds.join(", ");
}

export async function dispatchTaskNerveTasksWithPolicy(
  options: CodexTaskDispatchRequest,
): Promise<CodexTaskDispatchResult> {
  const requestedTaskIds = normalizeTaskIds(options.taskIds);
  const warnings: string[] = [];
  const projectTasks = options.projectTasks ?? [];
  const candidateTasks = options.candidateTasks ?? [];
  const tasksById = mergeTaskRecords(projectTasks, candidateTasks);

  if (requestedTaskIds.length === 0) {
    return {
      requested_task_ids: [],
      dispatched_task_ids: [],
      blocked_task_ids: [],
      blocked_by_quality_task_ids: [],
      blocked_by_assignment_task_ids: [],
      blocked_missing_task_ids: [],
      continue_task_ids: [],
      warnings,
    };
  }

  const qualityGate = options.taskNerve.gateDispatchTaskIdsByQuality({
    settings: options.settings,
    task_ids: requestedTaskIds,
    tasks: [...tasksById.values()],
  });

  if (qualityGate.blocked_task_ids.length > 0) {
    const label = normalizeOptionalText(options.label);
    warnings.push(
      label
        ? `Task quality gate blocked ${qualityGate.blocked_task_ids.length} ${label} dispatch item(s): ${joinTaskIds(qualityGate.blocked_task_ids)}`
        : `Task quality gate blocked ${qualityGate.blocked_task_ids.length} dispatch item(s): ${joinTaskIds(qualityGate.blocked_task_ids)}`,
    );
  }

  const assignmentGate = gateTaskDispatchByAssignment({
    taskIds: qualityGate.allowed_task_ids,
    tasksById,
    projectTasks,
  });

  if (assignmentGate.blocked_task_ids.length > 0) {
    warnings.push(
      `Task completion gate blocked ${assignmentGate.blocked_task_ids.length} dispatch item(s) because assigned agents still have unfinished work: ${joinTaskIds(
        assignmentGate.blocked_task_ids,
      )}`,
    );
    if (assignmentGate.continue_task_ids.length > 0) {
      warnings.push(
        `Controller should continue active task(s) instead: ${joinTaskIds(assignmentGate.continue_task_ids)}`,
      );
    }
  }

  const blockedMissingTaskIds = requestedTaskIds.filter((taskId) => !tasksById.has(taskId));

  const dispatchableTaskIds = [...assignmentGate.allowed_task_ids];
  let dispatchedTaskIds: string[] = [];
  if (dispatchableTaskIds.length > 0) {
    if (typeof options.host.dispatchTaskNerveTasks !== "function") {
      warnings.push("Codex host method dispatchTaskNerveTasks is unavailable");
    } else {
      await options.host.dispatchTaskNerveTasks({
        repoRoot: options.repoRoot,
        task_ids: dispatchableTaskIds,
      });
      dispatchedTaskIds = dispatchableTaskIds;
    }
  }

  return {
    requested_task_ids: requestedTaskIds,
    dispatched_task_ids: dispatchedTaskIds,
    blocked_task_ids: [
      ...qualityGate.blocked_task_ids,
      ...assignmentGate.blocked_task_ids,
    ],
    blocked_by_quality_task_ids: [...qualityGate.blocked_task_ids],
    blocked_by_assignment_task_ids: [...assignmentGate.blocked_task_ids],
    blocked_missing_task_ids: blockedMissingTaskIds,
    continue_task_ids: [...assignmentGate.continue_task_ids],
    warnings,
  };
}
