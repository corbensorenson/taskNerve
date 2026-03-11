import type { PromptQueueRequest, TaskRecord } from "../schemas.js";

const TASK_STATUS_RANK: Record<string, number> = {
  open: 0,
  claimed: 1,
  blocked: 2,
  done: 3,
};

function normalizeSearchText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
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
    const haystack = [
      task.task_id,
      task.title,
      task.detail,
      task.claimed_by_agent_id,
      ...(task.tags || []),
      ...(task.depends_on || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
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
