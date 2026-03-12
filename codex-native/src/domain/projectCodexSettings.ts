import {
  DEFAULT_HEARTBEAT_MESSAGE_CORE,
  DEFAULT_LOW_QUEUE_CONTROLLER_PROMPT,
  INTELLIGENCE_LEVELS,
  SCHEMA_PROJECT_CODEX_SETTINGS,
  nowIsoUtc,
} from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { projectCodexSettingsSchema } from "../schemas.js";

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text ? text : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInt(value: unknown, fallback: number, min = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(Number(value)));
}

function normalizeIntArray(value: unknown, min = 0, maxLen = 64): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((entry) => (Number.isFinite(entry) ? Math.max(min, Math.round(Number(entry))) : null))
    .filter((entry): entry is number => entry !== null);
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(normalized.length - maxLen);
}

function normalizeStringArray(value: unknown, maxLen = 32): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = [
    ...new Set(
      value
        .map((entry) => normalizeOptionalText(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(0, maxLen);
}

export function normalizeIntelligence(value: unknown): (typeof INTELLIGENCE_LEVELS)[number] | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return INTELLIGENCE_LEVELS.includes(
    normalized as (typeof INTELLIGENCE_LEVELS)[number],
  )
    ? (normalized as (typeof INTELLIGENCE_LEVELS)[number])
    : null;
}

export function defaultProjectCodexSettings(options: {
  nowIso?: string;
  gitOriginUrl?: string | null;
} = {}): ProjectCodexSettings {
  return projectCodexSettingsSchema.parse({
    schema_version: SCHEMA_PROJECT_CODEX_SETTINGS,
    updated_at_utc: options.nowIso ?? nowIsoUtc(),
    heartbeat_message_core: DEFAULT_HEARTBEAT_MESSAGE_CORE,
    low_queue_controller_prompt: DEFAULT_LOW_QUEUE_CONTROLLER_PROMPT,
    low_queue_controller_enabled: true,
    worker_single_message_mode: true,
    worker_model_routing_enabled: false,
    worker_default_model: null,
    controller_default_model: null,
    low_intelligence_model: null,
    medium_intelligence_model: null,
    high_intelligence_model: null,
    max_intelligence_model: null,
    git_origin_url: normalizeOptionalText(options.gitOriginUrl),
    git_auto_sync_enabled: true,
    git_tasks_per_push_target: 4,
    git_min_push_interval_minutes: 10,
    git_preferred_branch: null,
    git_auto_sync_allowed_branches: [],
    git_done_task_count_at_last_push: 0,
    git_last_push_at_utc: null,
    git_tasks_before_push_history: [],
    ci_auto_task_enabled: true,
    ci_failure_task_priority: 9,
    ci_default_assignee_agent_id: null,
    ci_last_sync_at_utc: null,
    ci_last_failed_job_count: 0,
    issues_sync_enabled: true,
    issues_auto_task_enabled: false,
    issues_auto_approve_trusted: false,
    issues_filter_enabled: true,
    issues_filter_min_trust_score: 65,
    issues_filter_blocked_labels: [],
    issues_filter_required_labels: [],
    issues_filter_blocked_authors: [],
    issues_filter_block_on_external_links: true,
  });
}

export function normalizeProjectCodexSettings(
  value: Partial<ProjectCodexSettings> = {},
  options: {
    nowIso?: string;
    gitOriginUrl?: string | null;
  } = {},
): ProjectCodexSettings {
  const defaults = defaultProjectCodexSettings(options);
  return projectCodexSettingsSchema.parse({
    schema_version: SCHEMA_PROJECT_CODEX_SETTINGS,
    updated_at_utc: normalizeOptionalText(value.updated_at_utc) ?? defaults.updated_at_utc,
    heartbeat_message_core:
      normalizeOptionalText(value.heartbeat_message_core) ?? defaults.heartbeat_message_core,
    low_queue_controller_prompt:
      normalizeOptionalText(value.low_queue_controller_prompt) ??
      defaults.low_queue_controller_prompt,
    low_queue_controller_enabled: normalizeBoolean(
      value.low_queue_controller_enabled,
      defaults.low_queue_controller_enabled,
    ),
    worker_single_message_mode: normalizeBoolean(
      value.worker_single_message_mode,
      defaults.worker_single_message_mode,
    ),
    worker_model_routing_enabled: normalizeBoolean(
      value.worker_model_routing_enabled,
      defaults.worker_model_routing_enabled,
    ),
    worker_default_model: normalizeOptionalText(value.worker_default_model),
    controller_default_model: normalizeOptionalText(value.controller_default_model),
    low_intelligence_model: normalizeOptionalText(value.low_intelligence_model),
    medium_intelligence_model: normalizeOptionalText(value.medium_intelligence_model),
    high_intelligence_model: normalizeOptionalText(value.high_intelligence_model),
    max_intelligence_model: normalizeOptionalText(value.max_intelligence_model),
    git_origin_url:
      normalizeOptionalText(value.git_origin_url) ?? normalizeOptionalText(options.gitOriginUrl),
    git_auto_sync_enabled: normalizeBoolean(
      value.git_auto_sync_enabled,
      defaults.git_auto_sync_enabled,
    ),
    git_tasks_per_push_target: normalizeInt(
      value.git_tasks_per_push_target,
      defaults.git_tasks_per_push_target,
      1,
    ),
    git_min_push_interval_minutes: normalizeInt(
      value.git_min_push_interval_minutes,
      defaults.git_min_push_interval_minutes,
      0,
    ),
    git_preferred_branch: normalizeOptionalText(value.git_preferred_branch),
    git_auto_sync_allowed_branches: normalizeStringArray(value.git_auto_sync_allowed_branches, 64),
    git_done_task_count_at_last_push: normalizeInt(
      value.git_done_task_count_at_last_push,
      defaults.git_done_task_count_at_last_push,
      0,
    ),
    git_last_push_at_utc: normalizeOptionalText(value.git_last_push_at_utc),
    git_tasks_before_push_history: normalizeIntArray(value.git_tasks_before_push_history, 0, 64),
    ci_auto_task_enabled: normalizeBoolean(value.ci_auto_task_enabled, defaults.ci_auto_task_enabled),
    ci_failure_task_priority: normalizeInt(
      value.ci_failure_task_priority,
      defaults.ci_failure_task_priority,
      0,
    ),
    ci_default_assignee_agent_id: normalizeOptionalText(value.ci_default_assignee_agent_id),
    ci_last_sync_at_utc: normalizeOptionalText(value.ci_last_sync_at_utc),
    ci_last_failed_job_count: normalizeInt(
      value.ci_last_failed_job_count,
      defaults.ci_last_failed_job_count,
      0,
    ),
    issues_sync_enabled: normalizeBoolean(value.issues_sync_enabled, defaults.issues_sync_enabled),
    issues_auto_task_enabled: normalizeBoolean(
      value.issues_auto_task_enabled,
      defaults.issues_auto_task_enabled,
    ),
    issues_auto_approve_trusted: normalizeBoolean(
      value.issues_auto_approve_trusted,
      defaults.issues_auto_approve_trusted,
    ),
    issues_filter_enabled: normalizeBoolean(
      value.issues_filter_enabled,
      defaults.issues_filter_enabled,
    ),
    issues_filter_min_trust_score: Math.min(
      100,
      normalizeInt(
        value.issues_filter_min_trust_score,
        defaults.issues_filter_min_trust_score,
        0,
      ),
    ),
    issues_filter_blocked_labels: normalizeStringArray(value.issues_filter_blocked_labels, 64),
    issues_filter_required_labels: normalizeStringArray(value.issues_filter_required_labels, 64),
    issues_filter_blocked_authors: normalizeStringArray(value.issues_filter_blocked_authors, 64),
    issues_filter_block_on_external_links: normalizeBoolean(
      value.issues_filter_block_on_external_links,
      defaults.issues_filter_block_on_external_links,
    ),
  });
}

export function resolveControllerModel(settings: Partial<ProjectCodexSettings>): string | null {
  return resolveControllerModelFromNormalizedSettings(normalizeProjectCodexSettings(settings));
}

export function resolveControllerModelFromNormalizedSettings(
  settings: ProjectCodexSettings,
): string | null {
  return settings.controller_default_model ?? null;
}

export function resolveWorkerModelForTaskWithNormalizedSettings(
  settings: ProjectCodexSettings,
  task: Partial<TaskRecord> = {},
): string | null {
  if (settings.worker_model_routing_enabled) {
    const explicitModel = normalizeOptionalText(task.suggested_model);
    if (explicitModel) {
      return explicitModel;
    }
    switch (normalizeIntelligence(task.suggested_intelligence)) {
      case "low":
        return settings.low_intelligence_model ?? settings.worker_default_model ?? null;
      case "medium":
        return settings.medium_intelligence_model ?? settings.worker_default_model ?? null;
      case "high":
        return settings.high_intelligence_model ?? settings.worker_default_model ?? null;
      case "max":
        return settings.max_intelligence_model ?? settings.worker_default_model ?? null;
      default:
        break;
    }
  }
  return settings.worker_default_model ?? null;
}

export function resolveWorkerModelForTask(
  settings: Partial<ProjectCodexSettings>,
  task: Partial<TaskRecord> = {},
): string | null {
  return resolveWorkerModelForTaskWithNormalizedSettings(
    normalizeProjectCodexSettings(settings),
    task,
  );
}
