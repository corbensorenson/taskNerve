import { nowIsoUtc } from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { normalizeProjectCodexSettings } from "./projectCodexSettings.js";

const GIT_PUSH_HISTORY_LIMIT = 64;

type GitSyncAction = "no-op" | "pull" | "push" | "pull-then-push";
type GitPushBlockedReason =
  | "no-commits-ahead"
  | "working-tree-dirty"
  | "insufficient-task-volume"
  | "missing-branch"
  | "missing-remote"
  | "branch-not-allowed";

export interface ProjectGitRepositoryState {
  branch: string | null;
  remote: string | null;
  ahead_count: number;
  behind_count: number;
  changed_file_count: number;
  staged_file_count: number;
  untracked_file_count: number;
  clean: boolean;
}

export interface BuildProjectGitSyncSnapshotOptions {
  settings: Partial<ProjectCodexSettings>;
  tasks?: Partial<TaskRecord>[];
  git_state?: Partial<ProjectGitRepositoryState> | null;
  now_iso?: string;
}

export interface ProjectGitSyncSnapshot {
  integration_mode: "codex-native-host";
  generated_at_utc: string;
  repository: ProjectGitRepositoryState;
  push_policy: {
    auto_sync_enabled: boolean;
    tasks_per_push_target: number;
    min_push_interval_minutes: number;
    preferred_branch: string | null;
    auto_sync_allowed_branches: string[];
  };
  branch_status: {
    current_branch: string | null;
    on_preferred_branch: boolean | null;
    auto_sync_branch_allowed: boolean;
  };
  task_metrics: {
    done_task_count: number;
    done_task_count_at_last_push: number;
    done_tasks_since_last_push: number;
    tasks_until_target_push: number;
    average_tasks_before_push: number | null;
    push_samples: number;
  };
  push_tracking: {
    last_push_at_utc: string | null;
    tasks_before_push_history: number[];
  };
  recommendation: {
    action: GitSyncAction;
    should_sync: boolean;
    reason:
      | "pull-required"
      | "push-due"
      | "pull-and-push-due"
      | "push-blocked"
      | "within-push-cadence"
      | "auto-sync-disabled";
    push_blocked_reason: GitPushBlockedReason | null;
  };
}

export interface BuildProjectSettingsAfterGitPushOptions {
  settings: Partial<ProjectCodexSettings>;
  tasks?: Partial<TaskRecord>[];
  pushed_at_utc?: string;
  tasks_pushed_count?: number;
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

function normalizeIntArray(value: unknown, min = 0, limit = GIT_PUSH_HISTORY_LIMIT): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((entry) => (Number.isFinite(entry) ? Math.max(min, Math.round(Number(entry))) : null))
    .filter((entry): entry is number => entry !== null);
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(normalized.length - limit);
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

function average(value: number[]): number | null {
  if (value.length === 0) {
    return null;
  }
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total += value[index]!;
  }
  return Number((total / value.length).toFixed(2));
}

function doneTaskCount(tasks: Partial<TaskRecord>[]): number {
  let done = 0;
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index]?.status === "done") {
      done += 1;
    }
  }
  return done;
}

function minutesSince(timestampUtc: string | null, nowUtc: string): number | null {
  if (!timestampUtc) {
    return null;
  }
  const from = Date.parse(timestampUtc);
  const to = Date.parse(nowUtc);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  return (to - from) / 60000;
}

function normalizeRepositoryState(
  state: Partial<ProjectGitRepositoryState> | null | undefined,
): ProjectGitRepositoryState {
  const branch = normalizeOptionalText(state?.branch);
  const remote = normalizeOptionalText(state?.remote);
  const ahead = normalizeInt(state?.ahead_count, 0, 0);
  const behind = normalizeInt(state?.behind_count, 0, 0);
  const changed = normalizeInt(state?.changed_file_count, 0, 0);
  const staged = normalizeInt(state?.staged_file_count, 0, 0);
  const untracked = normalizeInt(state?.untracked_file_count, 0, 0);
  const explicitClean = typeof state?.clean === "boolean" ? state.clean : null;
  const dirtyCount = changed + staged + untracked;

  return {
    branch,
    remote,
    ahead_count: ahead,
    behind_count: behind,
    changed_file_count: changed,
    staged_file_count: staged,
    untracked_file_count: untracked,
    clean: explicitClean ?? dirtyCount === 0,
  };
}

function buildRecommendation(options: {
  autoSyncEnabled: boolean;
  doneSinceLastPush: number;
  tasksPerPushTarget: number;
  minPushIntervalMinutes: number;
  minutesSinceLastPush: number | null;
  repository: ProjectGitRepositoryState;
  preferredBranch: string | null;
  autoSyncAllowedBranches: string[];
}): ProjectGitSyncSnapshot["recommendation"] {
  const needsPull = options.repository.behind_count > 0;
  const hasPushVolume = options.doneSinceLastPush >= options.tasksPerPushTarget;
  const pushDueByInterval =
    options.doneSinceLastPush > 0 &&
    options.minutesSinceLastPush !== null &&
    options.minutesSinceLastPush >= options.minPushIntervalMinutes;
  const pushDue = hasPushVolume || pushDueByInterval;
  const branch = normalizeOptionalText(options.repository.branch);
  const remote = normalizeOptionalText(options.repository.remote);
  const allowedBranches = normalizeStringArray(options.autoSyncAllowedBranches, 64);
  const branchAllowed =
    !branch || allowedBranches.length === 0 ? true : allowedBranches.includes(branch);
  let pushBlockedReason: GitPushBlockedReason | null = null;
  if (!pushDue) {
    pushBlockedReason = "insufficient-task-volume";
  } else if (!branch) {
    pushBlockedReason = "missing-branch";
  } else if (!remote) {
    pushBlockedReason = "missing-remote";
  } else if (!branchAllowed) {
    pushBlockedReason = "branch-not-allowed";
  } else if (!options.repository.clean) {
    pushBlockedReason = "working-tree-dirty";
  } else if (options.repository.ahead_count <= 0) {
    pushBlockedReason = "no-commits-ahead";
  }

  if (!options.autoSyncEnabled) {
    return {
      action: "no-op",
      should_sync: false,
      reason: "auto-sync-disabled",
      push_blocked_reason: pushBlockedReason,
    };
  }

  if (needsPull && pushDue && pushBlockedReason === null) {
    return {
      action: "pull-then-push",
      should_sync: true,
      reason: "pull-and-push-due",
      push_blocked_reason: null,
    };
  }

  if (needsPull) {
    return {
      action: "pull",
      should_sync: true,
      reason: "pull-required",
      push_blocked_reason: pushBlockedReason,
    };
  }

  if (pushDue && pushBlockedReason === null) {
    return {
      action: "push",
      should_sync: true,
      reason: "push-due",
      push_blocked_reason: null,
    };
  }

  if (pushDue) {
    return {
      action: "no-op",
      should_sync: false,
      reason: "push-blocked",
      push_blocked_reason: pushBlockedReason,
    };
  }

  return {
    action: "no-op",
    should_sync: false,
    reason: "within-push-cadence",
    push_blocked_reason: pushBlockedReason,
  };
}

export function buildProjectGitSyncSnapshot(
  options: BuildProjectGitSyncSnapshotOptions,
): ProjectGitSyncSnapshot {
  const normalizedSettings = normalizeProjectCodexSettings(options.settings);
  const generatedAtUtc = normalizeOptionalText(options.now_iso) || nowIsoUtc();
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const doneCount = doneTaskCount(tasks);
  const doneAtLastPush = normalizeInt(normalizedSettings.git_done_task_count_at_last_push, 0, 0);
  const doneSinceLastPush = Math.max(0, doneCount - doneAtLastPush);
  const tasksPerPushTarget = normalizeInt(normalizedSettings.git_tasks_per_push_target, 4, 1);
  const minPushIntervalMinutes = normalizeInt(
    normalizedSettings.git_min_push_interval_minutes,
    10,
    0,
  );
  const history = normalizeIntArray(normalizedSettings.git_tasks_before_push_history, 0);
  const repository = normalizeRepositoryState(options.git_state);
  const preferredBranch = normalizeOptionalText(normalizedSettings.git_preferred_branch);
  const allowedBranches = normalizeStringArray(normalizedSettings.git_auto_sync_allowed_branches, 64);
  const branch = normalizeOptionalText(repository.branch);
  const onPreferredBranch = preferredBranch === null ? null : branch === preferredBranch;
  const autoSyncBranchAllowed =
    !branch || allowedBranches.length === 0 ? true : allowedBranches.includes(branch);
  const minutesFromLastPush = minutesSince(
    normalizeOptionalText(normalizedSettings.git_last_push_at_utc),
    generatedAtUtc,
  );

  return {
    integration_mode: "codex-native-host",
    generated_at_utc: generatedAtUtc,
    repository,
    push_policy: {
      auto_sync_enabled: Boolean(normalizedSettings.git_auto_sync_enabled),
      tasks_per_push_target: tasksPerPushTarget,
      min_push_interval_minutes: minPushIntervalMinutes,
      preferred_branch: preferredBranch,
      auto_sync_allowed_branches: allowedBranches,
    },
    branch_status: {
      current_branch: branch,
      on_preferred_branch: onPreferredBranch,
      auto_sync_branch_allowed: autoSyncBranchAllowed,
    },
    task_metrics: {
      done_task_count: doneCount,
      done_task_count_at_last_push: doneAtLastPush,
      done_tasks_since_last_push: doneSinceLastPush,
      tasks_until_target_push: Math.max(0, tasksPerPushTarget - doneSinceLastPush),
      average_tasks_before_push: average(history),
      push_samples: history.length,
    },
    push_tracking: {
      last_push_at_utc: normalizeOptionalText(normalizedSettings.git_last_push_at_utc),
      tasks_before_push_history: history,
    },
    recommendation: buildRecommendation({
      autoSyncEnabled: Boolean(normalizedSettings.git_auto_sync_enabled),
      doneSinceLastPush,
      tasksPerPushTarget,
      minPushIntervalMinutes,
      minutesSinceLastPush: minutesFromLastPush,
      repository,
      preferredBranch,
      autoSyncAllowedBranches: allowedBranches,
    }),
  };
}

export function buildProjectSettingsAfterGitPush(
  options: BuildProjectSettingsAfterGitPushOptions,
): ProjectCodexSettings {
  const normalizedSettings = normalizeProjectCodexSettings(options.settings);
  const pushedAtUtc = normalizeOptionalText(options.pushed_at_utc) || nowIsoUtc();
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const doneCount = doneTaskCount(tasks);
  const doneAtLastPush = normalizeInt(normalizedSettings.git_done_task_count_at_last_push, 0, 0);
  const tasksPushedCount =
    Number.isFinite(options.tasks_pushed_count) && Number(options.tasks_pushed_count) >= 0
      ? Math.round(Number(options.tasks_pushed_count))
      : Math.max(0, doneCount - doneAtLastPush);

  const nextHistory = normalizeIntArray(
    [...normalizedSettings.git_tasks_before_push_history, tasksPushedCount],
    0,
    GIT_PUSH_HISTORY_LIMIT,
  );

  return normalizeProjectCodexSettings({
    ...normalizedSettings,
    git_last_push_at_utc: pushedAtUtc,
    git_done_task_count_at_last_push: doneCount,
    git_tasks_before_push_history: nextHistory,
  });
}
