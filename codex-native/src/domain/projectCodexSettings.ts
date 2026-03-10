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
  });
}

export function resolveControllerModel(settings: Partial<ProjectCodexSettings>): string | null {
  return normalizeProjectCodexSettings(settings).controller_default_model ?? null;
}

export function resolveWorkerModelForTask(
  settings: Partial<ProjectCodexSettings>,
  task: Partial<TaskRecord> = {},
): string | null {
  const normalized = normalizeProjectCodexSettings(settings);
  if (normalized.worker_model_routing_enabled) {
    const explicitModel = normalizeOptionalText(task.suggested_model);
    if (explicitModel) {
      return explicitModel;
    }
    switch (normalizeIntelligence(task.suggested_intelligence)) {
      case "low":
        return normalized.low_intelligence_model ?? normalized.worker_default_model ?? null;
      case "medium":
        return normalized.medium_intelligence_model ?? normalized.worker_default_model ?? null;
      case "high":
        return normalized.high_intelligence_model ?? normalized.worker_default_model ?? null;
      case "max":
        return normalized.max_intelligence_model ?? normalized.worker_default_model ?? null;
      default:
        break;
    }
  }
  return normalized.worker_default_model ?? null;
}
