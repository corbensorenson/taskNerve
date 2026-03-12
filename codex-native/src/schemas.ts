import { z } from "zod";

import {
  SCHEMA_PROJECT_AGENT_WATCHDOG_STATE,
  SCHEMA_PROJECT_CODEX_SETTINGS,
  SCHEMA_PROJECTS,
} from "./constants.js";

export const taskStatusSchema = z.enum(["open", "claimed", "blocked", "done"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const intelligenceLevelSchema = z.enum(["low", "medium", "high", "max"]);
export type IntelligenceLevel = z.infer<typeof intelligenceLevelSchema>;

export const taskTypeSchema = z.enum([
  "feature",
  "bugfix",
  "refactor",
  "maintenance",
  "research",
  "docs",
  "ops",
  "test",
]);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const taskEffortSchema = z.enum(["xs", "s", "m", "l"]);
export type TaskEffort = z.infer<typeof taskEffortSchema>;

export const taskSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  detail: z.string().nullable().optional(),
  objective: z.string().trim().min(1).nullish(),
  task_type: taskTypeSchema.nullish(),
  subsystem: z.string().trim().min(1).nullish(),
  priority: z.number().int().default(0),
  tags: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  files_in_scope: z.array(z.string().trim().min(1)).default([]),
  out_of_scope: z.array(z.string().trim().min(1)).default([]),
  acceptance_criteria: z.array(z.string().trim().min(1)).default([]),
  deliverables: z.array(z.string().trim().min(1)).default([]),
  verification_steps: z.array(z.string().trim().min(1)).default([]),
  implementation_notes: z.string().trim().min(1).nullish(),
  risk_notes: z.array(z.string().trim().min(1)).default([]),
  estimated_effort: taskEffortSchema.nullish(),
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
  worker_model_routing_enabled: z.boolean().default(true),
  worker_route_wait_for_match: z.boolean().default(true),
  worker_route_allow_retarget: z.boolean().default(true),
  worker_route_prefer_spawn: z.boolean().default(true),
  worker_route_match_effort: z.boolean().default(true),
  task_quality_gate_enabled: z.boolean().default(true),
  task_quality_gate_min_score: z.number().int().min(0).max(100).default(80),
  task_quality_gate_include_ci: z.boolean().default(false),
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
  trace_collection_enabled: z.boolean().default(true),
  trace_capture_controller: z.boolean().default(true),
  trace_capture_agents: z.boolean().default(true),
  trace_include_message_content: z.boolean().default(true),
  trace_max_content_chars: z.number().int().min(1).max(200_000).default(16_000),
  self_improvement_enabled: z.boolean().default(true),
  self_improvement_auto_dispatch_enabled: z.boolean().default(true),
  self_improvement_max_tasks_per_run: z.number().int().min(1).max(16).default(2),
  self_improvement_open_task_limit: z.number().int().min(1).max(64).default(6),
  self_improvement_dispatch_cooldown_minutes: z.number().int().min(0).max(2_880).default(45),
  self_improvement_last_dispatch_at_utc: z.string().trim().min(1).nullish(),
  issues_sync_enabled: z.boolean().default(true),
  issues_auto_task_enabled: z.boolean().default(false),
  issues_auto_approve_trusted: z.boolean().default(false),
  issues_filter_enabled: z.boolean().default(true),
  issues_filter_min_trust_score: z.number().int().min(0).max(100).default(65),
  issues_filter_blocked_labels: z.array(z.string().trim().min(1)).default([]),
  issues_filter_required_labels: z.array(z.string().trim().min(1)).default([]),
  issues_filter_blocked_authors: z.array(z.string().trim().min(1)).default([]),
  issues_filter_block_on_external_links: z.boolean().default(true),
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

export const projectAgentWatchdogStateSchema = z.object({
  schema_version: z.string().default(SCHEMA_PROJECT_AGENT_WATCHDOG_STATE),
  updated_at_utc: z.string(),
  controller_last_reset_at_utc: z.string().trim().min(1).nullish(),
  last_recovery_by_task: z.record(z.string(), z.string()).default({}),
  last_recovery_by_thread: z.record(z.string(), z.string()).default({}),
});
export type ProjectAgentWatchdogState = z.infer<typeof projectAgentWatchdogStateSchema>;

export const promptQueueRequestSchema = z.object({
  prompt_id: z.string(),
  agent_id: z.string(),
  thread_id: z.string(),
  status: z.enum(["pending", "running", "sent", "skipped", "error"]).default("pending"),
});
export type PromptQueueRequest = z.infer<typeof promptQueueRequestSchema>;
