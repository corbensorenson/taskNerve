import { z } from "zod";

import { SCHEMA_PROJECT_CODEX_SETTINGS, SCHEMA_PROJECTS } from "./constants.js";

export const taskStatusSchema = z.enum(["open", "claimed", "blocked", "done"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const intelligenceLevelSchema = z.enum(["low", "medium", "high", "max"]);
export type IntelligenceLevel = z.infer<typeof intelligenceLevelSchema>;

export const taskSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  detail: z.string().nullable().optional(),
  priority: z.number().int().default(0),
  tags: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  status: taskStatusSchema.default("open"),
  ready: z.boolean().optional(),
  claimed_by_agent_id: z.string().nullable().optional(),
  suggested_intelligence: intelligenceLevelSchema.nullish(),
  suggested_model: z.string().trim().min(1).nullish(),
});
export type TaskRecord = z.infer<typeof taskSchema>;

export const projectCodexSettingsSchema = z.object({
  schema_version: z.string().default(SCHEMA_PROJECT_CODEX_SETTINGS),
  updated_at_utc: z.string(),
  heartbeat_message_core: z.string(),
  low_queue_controller_prompt: z.string(),
  low_queue_controller_enabled: z.boolean().default(true),
  worker_single_message_mode: z.boolean().default(true),
  worker_model_routing_enabled: z.boolean().default(false),
  worker_default_model: z.string().trim().min(1).nullish(),
  controller_default_model: z.string().trim().min(1).nullish(),
  low_intelligence_model: z.string().trim().min(1).nullish(),
  medium_intelligence_model: z.string().trim().min(1).nullish(),
  high_intelligence_model: z.string().trim().min(1).nullish(),
  max_intelligence_model: z.string().trim().min(1).nullish(),
  git_origin_url: z.string().trim().min(1).nullish(),
  git_auto_sync_enabled: z.boolean().default(true),
  git_tasks_per_push_target: z.number().int().min(1).default(4),
  git_min_push_interval_minutes: z.number().int().min(0).default(10),
  git_preferred_branch: z.string().trim().min(1).nullish(),
  git_auto_sync_allowed_branches: z.array(z.string().trim().min(1)).default([]),
  git_done_task_count_at_last_push: z.number().int().min(0).default(0),
  git_last_push_at_utc: z.string().trim().min(1).nullish(),
  git_tasks_before_push_history: z.array(z.number().int().min(0)).default([]),
  ci_auto_task_enabled: z.boolean().default(true),
  ci_failure_task_priority: z.number().int().min(0).default(9),
  ci_default_assignee_agent_id: z.string().trim().min(1).nullish(),
  ci_last_sync_at_utc: z.string().trim().min(1).nullish(),
  ci_last_failed_job_count: z.number().int().min(0).default(0),
});
export type ProjectCodexSettings = z.infer<typeof projectCodexSettingsSchema>;

export const registeredProjectSchema = z.object({
  name: z.string(),
  repo_root: z.string(),
  added_at_utc: z.string(),
  updated_at_utc: z.string(),
  last_activity_at_utc: z.string().nullish(),
  last_opened_at_utc: z.string().nullish(),
});
export type RegisteredProject = z.infer<typeof registeredProjectSchema>;

export const projectRegistrySchema = z.object({
  schema_version: z.string().default(SCHEMA_PROJECTS),
  updated_at_utc: z.string(),
  default_project: z.string().nullish(),
  projects: z.array(registeredProjectSchema).default([]),
});
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;

export const promptQueueRequestSchema = z.object({
  prompt_id: z.string(),
  agent_id: z.string(),
  thread_id: z.string(),
  status: z.enum(["pending", "running", "sent", "skipped", "error"]).default("pending"),
});
export type PromptQueueRequest = z.infer<typeof promptQueueRequestSchema>;
