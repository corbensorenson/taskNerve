import path from "node:path";

import { CONTROLLER_AGENT_ID, nowIsoUtc } from "../constants.js";
import type { CodexHostServices } from "../host/codexHostServices.js";
import {
  loadProjectAgentWatchdogState,
  writeProjectAgentWatchdogState,
} from "../io/projectAgentWatchdogStateStore.js";
import type {
  ProjectAgentWatchdogState,
  TaskRecord,
} from "../schemas.js";
import type { TaskNerveService } from "./taskNerveService.js";
import {
  parseWaitHintDetailsFromText,
  statusSuggestsWaiting,
} from "./codexAgentWatchdogWaitHints.js";
import type {
  CodexAgentWatchdogAction,
  CodexAgentWatchdogPolicy,
  CodexAgentWatchdogRunOptions,
  CodexAgentWatchdogRunResult,
} from "./codexAgentWatchdog.types.js";

export type {
  CodexAgentWatchdogAction,
  CodexAgentWatchdogPolicy,
  CodexAgentWatchdogRunOptions,
  CodexAgentWatchdogRunResult,
} from "./codexAgentWatchdog.types.js";

const DEFAULT_AGENT_WATCHDOG_POLICY: CodexAgentWatchdogPolicy = {
  enabled: true,
  min_runtime_minutes: 30,
  max_output_gap_minutes: 14,
  min_gap_runtime_ratio: 0.4,
  waiting_hint_grace_minutes: 90,
  task_recovery_cooldown_minutes: 25,
  controller_recovery_cooldown_minutes: 35,
  max_resets_per_run: 2,
};

interface CodexAgentWatchdogDependencies {
  host: CodexHostServices;
  taskNerve: TaskNerveService;
}

interface ParsedThreadSummary {
  thread_id: string;
  title: string | null;
  role: string | null;
  scope: "controller" | "agent" | "other";
  agent_id: string | null;
  model: string | null;
  status: string | null;
  created_at_utc: string | null;
  updated_at_utc: string | null;
  first_activity_at_utc: string | null;
  last_activity_at_utc: string | null;
  last_output_at_utc: string | null;
  last_output_text: string | null;
  last_output_wait_hint: boolean;
  last_output_wait_hint_minutes: number | null;
  user_turn_after_last_output: boolean;
  last_turn_role: string | null;
  runtime_minutes: number | null;
  output_gap_minutes: number | null;
}

interface ClaimedTaskForWatchdog {
  task_id: string;
  title: string;
  agent_id: string;
  task: Partial<TaskRecord>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeInt(value: unknown, fallback: number, min: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(Number(value)));
}

function normalizeFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Number(value)));
}

function normalizePolicy(policy?: Partial<CodexAgentWatchdogPolicy>): CodexAgentWatchdogPolicy {
  return {
    enabled: policy?.enabled !== false,
    min_runtime_minutes: normalizeInt(
      policy?.min_runtime_minutes,
      DEFAULT_AGENT_WATCHDOG_POLICY.min_runtime_minutes,
      1,
    ),
    max_output_gap_minutes: normalizeInt(
      policy?.max_output_gap_minutes,
      DEFAULT_AGENT_WATCHDOG_POLICY.max_output_gap_minutes,
      1,
    ),
    min_gap_runtime_ratio: normalizeFloat(
      policy?.min_gap_runtime_ratio,
      DEFAULT_AGENT_WATCHDOG_POLICY.min_gap_runtime_ratio,
      0.05,
      0.99,
    ),
    waiting_hint_grace_minutes: normalizeInt(
      policy?.waiting_hint_grace_minutes,
      DEFAULT_AGENT_WATCHDOG_POLICY.waiting_hint_grace_minutes,
      1,
    ),
    task_recovery_cooldown_minutes: normalizeInt(
      policy?.task_recovery_cooldown_minutes,
      DEFAULT_AGENT_WATCHDOG_POLICY.task_recovery_cooldown_minutes,
      0,
    ),
    controller_recovery_cooldown_minutes: normalizeInt(
      policy?.controller_recovery_cooldown_minutes,
      DEFAULT_AGENT_WATCHDOG_POLICY.controller_recovery_cooldown_minutes,
      0,
    ),
    max_resets_per_run: normalizeInt(
      policy?.max_resets_per_run,
      DEFAULT_AGENT_WATCHDOG_POLICY.max_resets_per_run,
      1,
    ),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: Record<string, unknown>[] = [];
  for (const entry of value) {
    const parsed = asRecord(entry);
    if (parsed) {
      normalized.push(parsed);
    }
  }
  return normalized;
}

function firstRecordArray(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const parsed = asRecordArray(record[key]);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

function parseThreadList(payload: unknown): Record<string, unknown>[] {
  const direct = asRecordArray(payload);
  if (direct.length > 0) {
    return direct;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const directCandidates = firstRecordArray(record, ["threads", "items", "results", "data"]);
  if (directCandidates.length > 0) {
    return directCandidates;
  }
  for (const key of ["payload", "response", "value"]) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const nestedCandidates = firstRecordArray(nested, ["threads", "items", "results", "data"]);
    if (nestedCandidates.length > 0) {
      return nestedCandidates;
    }
  }
  return [];
}

function parseTimestampMs(value: unknown): number | null {
  const text = normalizeOptionalText(value);
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoOrNull(ms: number | null): string | null {
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms as number).toISOString();
}

function parseThreadScope(options: {
  role: string | null;
  title: string | null;
  agentId: string | null;
}): "controller" | "agent" | "other" {
  const role = (options.role || "").toLowerCase();
  const title = (options.title || "").toLowerCase();
  const agentId = (options.agentId || "").toLowerCase();
  if (
    role.includes("controller") ||
    title.includes("controller") ||
    agentId === CONTROLLER_AGENT_ID.toLowerCase()
  ) {
    return "controller";
  }
  if (
    role.includes("agent") ||
    role.includes("worker") ||
    title.includes("agent") ||
    title.includes("worker") ||
    agentId.startsWith("agent.")
  ) {
    return "agent";
  }
  return "other";
}

function parseTurnRole(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    normalizeOptionalText(record.role) ??
    normalizeOptionalText(record.author_role) ??
    normalizeOptionalText(record.speaker) ??
    normalizeOptionalText(record.actor)
  );
}

function parseTurnTimestampMs(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    parseTimestampMs(record.created_at_utc) ??
    parseTimestampMs(record.created_at) ??
    parseTimestampMs(record.createdAt) ??
    parseTimestampMs(record.timestamp) ??
    parseTimestampMs(record.ts)
  );
}

function extractTextParts(value: unknown, depth = 0): string[] {
  if (depth > 5) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextParts(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const pieces: string[] = [];
  for (const key of ["text", "message", "body", "markdown", "value", "content_text"]) {
    const part = normalizeOptionalText(record[key]);
    if (part) {
      pieces.push(part);
    }
  }
  for (const key of [
    "content",
    "contents",
    "parts",
    "segments",
    "delta",
    "input",
    "output",
    "data",
    "item",
    "items",
    "message",
    "messages",
    "output_items",
    "input_items",
    "outputItems",
    "inputItems",
  ]) {
    if (!(key in record)) {
      continue;
    }
    pieces.push(...extractTextParts(record[key], depth + 1));
  }
  return pieces;
}

function parseTurnText(value: unknown): string | null {
  const parts = extractTextParts(value);
  if (parts.length === 0) {
    return null;
  }
  const joined = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return joined || null;
}

function parseThreadSummary(record: Record<string, unknown>, nowMs: number): ParsedThreadSummary | null {
  const thread = asRecord(record.thread) ?? record;
  const threadId =
    normalizeOptionalText(thread.thread_id) ??
    normalizeOptionalText(thread.threadId) ??
    normalizeOptionalText(thread.id);
  if (!threadId) {
    return null;
  }
  const agentId =
    normalizeOptionalText(thread.agent_id) ??
    normalizeOptionalText(thread.agentId) ??
    normalizeOptionalText(thread.worker_id);
  const title =
    normalizeOptionalText(thread.title) ??
    normalizeOptionalText(thread.name) ??
    normalizeOptionalText(thread.thread_name);
  const role =
    normalizeOptionalText(thread.role) ??
    normalizeOptionalText(thread.thread_role) ??
    normalizeOptionalText(thread.type);
  const scope = parseThreadScope({
    role,
    title,
    agentId,
  });
  const turns = firstRecordArray(thread, ["turns", "messages", "entries", "history", "events"]);
  const threadCreatedMs =
    parseTimestampMs(thread.created_at_utc) ??
    parseTimestampMs(thread.created_at) ??
    parseTimestampMs(thread.createdAt) ??
    null;
  const threadUpdatedMs =
    parseTimestampMs(thread.updated_at_utc) ??
    parseTimestampMs(thread.updated_at) ??
    parseTimestampMs(thread.updatedAt) ??
    parseTimestampMs(thread.last_activity_at) ??
    parseTimestampMs(thread.last_activity_at_utc) ??
    null;
  const status =
    normalizeOptionalText(thread.status) ??
    normalizeOptionalText(thread.thread_status) ??
    normalizeOptionalText(thread.run_status);

  let firstTurnMs: number | null = null;
  let lastTurnMs: number | null = null;
  let lastOutputMs: number | null = null;
  let lastOutputText: string | null = null;
  let lastOutputWaitHint = false;
  let lastOutputWaitHintMinutes: number | null = null;
  let lastOutputTurnIndex = -1;
  let lastUserTurnIndex = -1;
  let lastTurnRole: string | null = null;

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    const turnMs = parseTurnTimestampMs(turn);
    const turnRole = parseTurnRole(turn);
    const turnText = parseTurnText(turn);
    if (turnRole) {
      lastTurnRole = turnRole;
    }
    const normalizedRole = (turnRole || "").toLowerCase();
    if (normalizedRole.includes("user")) {
      lastUserTurnIndex = index;
    }
    const isOutputRole =
      normalizedRole.includes("assistant") ||
      normalizedRole.includes("agent") ||
      normalizedRole.includes("worker") ||
      normalizedRole.includes("tool") ||
      normalizedRole.includes("model");
    if (isOutputRole) {
      const waitHint = parseWaitHintDetailsFromText(turnText);
      if (turnMs === null) {
        if (lastOutputMs === null && index >= lastOutputTurnIndex) {
          lastOutputText = turnText;
          lastOutputWaitHint = waitHint.suggests_wait;
          lastOutputWaitHintMinutes = waitHint.duration_minutes;
          lastOutputTurnIndex = index;
        }
      } else if (lastOutputMs === null || turnMs >= lastOutputMs) {
        lastOutputMs = turnMs;
        lastOutputText = turnText;
        lastOutputWaitHint = waitHint.suggests_wait;
        lastOutputWaitHintMinutes = waitHint.duration_minutes;
        lastOutputTurnIndex = index;
      }
    }
    if (turnMs === null) {
      continue;
    }
    if (firstTurnMs === null || turnMs < firstTurnMs) {
      firstTurnMs = turnMs;
    }
    if (lastTurnMs === null || turnMs >= lastTurnMs) {
      lastTurnMs = turnMs;
    }
  }

  const firstActivityMs = firstTurnMs ?? threadCreatedMs ?? threadUpdatedMs;
  const lastActivityMs = lastTurnMs ?? threadUpdatedMs ?? threadCreatedMs;
  const outputAnchorMs = lastOutputMs ?? lastActivityMs ?? firstActivityMs;
  const userTurnAfterLastOutput =
    lastOutputTurnIndex >= 0 && lastUserTurnIndex > lastOutputTurnIndex;
  const runtimeMinutes =
    firstActivityMs !== null && nowMs >= firstActivityMs ? (nowMs - firstActivityMs) / 60000 : null;
  const outputGapMinutes =
    outputAnchorMs !== null && nowMs >= outputAnchorMs ? (nowMs - outputAnchorMs) / 60000 : null;

  return {
    thread_id: threadId,
    title,
    role,
    scope,
    agent_id: agentId,
    model:
      normalizeOptionalText(thread.model) ??
      normalizeOptionalText(thread.model_name) ??
      normalizeOptionalText(thread.default_model),
    status,
    created_at_utc: toIsoOrNull(threadCreatedMs),
    updated_at_utc: toIsoOrNull(threadUpdatedMs),
    first_activity_at_utc: toIsoOrNull(firstActivityMs),
    last_activity_at_utc: toIsoOrNull(lastActivityMs),
    last_output_at_utc: toIsoOrNull(lastOutputMs),
    last_output_text: lastOutputText,
    last_output_wait_hint: lastOutputWaitHint || statusSuggestsWaiting(status),
    last_output_wait_hint_minutes: lastOutputWaitHintMinutes,
    user_turn_after_last_output: userTurnAfterLastOutput,
    last_turn_role: lastTurnRole,
    runtime_minutes: runtimeMinutes,
    output_gap_minutes: outputGapMinutes,
  };
}

function effectiveWaitHintGraceMinutes(
  thread: ParsedThreadSummary,
  policy: CodexAgentWatchdogPolicy,
): number {
  const hintedMinutes = Number(thread.last_output_wait_hint_minutes);
  if (!Number.isFinite(hintedMinutes) || hintedMinutes <= 0) {
    return policy.waiting_hint_grace_minutes;
  }
  const extraBufferMinutes = Math.min(30, Math.max(5, hintedMinutes * 0.2));
  return Math.max(policy.waiting_hint_grace_minutes, hintedMinutes + extraBufferMinutes);
}

function selectNewestThreadByAgent(
  threads: ParsedThreadSummary[],
): Map<string, ParsedThreadSummary> {
  const byAgent = new Map<string, ParsedThreadSummary>();
  for (const thread of threads) {
    const agentId = normalizeOptionalText(thread.agent_id);
    if (!agentId) {
      continue;
    }
    const existing = byAgent.get(agentId);
    const existingAt = Date.parse(existing?.last_activity_at_utc || "");
    const candidateAt = Date.parse(thread.last_activity_at_utc || "");
    if (!existing) {
      byAgent.set(agentId, thread);
      continue;
    }
    const existingValid = Number.isFinite(existingAt);
    const candidateValid = Number.isFinite(candidateAt);
    if (!existingValid && candidateValid) {
      byAgent.set(agentId, thread);
      continue;
    }
    if (existingValid && candidateValid && candidateAt >= existingAt) {
      byAgent.set(agentId, thread);
      continue;
    }
  }
  return byAgent;
}

function normalizeTaskStatus(value: unknown): "open" | "claimed" | "blocked" | "done" {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (normalized === "claimed" || normalized === "blocked" || normalized === "done") {
    return normalized;
  }
  return "open";
}

function parseClaimedTasks(tasks: Partial<TaskRecord>[]): ClaimedTaskForWatchdog[] {
  const claimed: ClaimedTaskForWatchdog[] = [];
  for (const task of tasks) {
    if (normalizeTaskStatus(task.status) !== "claimed") {
      continue;
    }
    const taskId = normalizeOptionalText(task.task_id);
    const agentId = normalizeOptionalText(task.claimed_by_agent_id);
    const title = normalizeOptionalText(task.title);
    if (!taskId || !agentId || !title) {
      continue;
    }
    claimed.push({
      task_id: taskId,
      title,
      agent_id: agentId,
      task,
    });
  }
  return claimed;
}

function isLikelyActiveThread(thread: ParsedThreadSummary): boolean {
  const normalizedStatus = (thread.status || "").toLowerCase();
  if (
    normalizedStatus.includes("running") ||
    normalizedStatus.includes("thinking") ||
    normalizedStatus.includes("in_progress") ||
    normalizedStatus.includes("pending")
  ) {
    return true;
  }
  const lastTurnRole = (thread.last_turn_role || "").toLowerCase();
  if (!lastTurnRole) {
    return false;
  }
  if (lastTurnRole.includes("user") || lastTurnRole.includes("controller") || lastTurnRole.includes("system")) {
    return true;
  }
  return false;
}

function isThreadStalled(
  thread: ParsedThreadSummary,
  policy: CodexAgentWatchdogPolicy,
  requireLikelyActive: boolean,
): { stalled: boolean; reason: string } {
  const runtimeMinutes = Number(thread.runtime_minutes);
  const outputGapMinutes = Number(thread.output_gap_minutes);
  if (!Number.isFinite(runtimeMinutes) || !Number.isFinite(outputGapMinutes)) {
    return {
      stalled: false,
      reason: "missing-time-metrics",
    };
  }
  if (runtimeMinutes < policy.min_runtime_minutes) {
    return {
      stalled: false,
      reason: "runtime-below-threshold",
    };
  }
  if (outputGapMinutes < policy.max_output_gap_minutes) {
    return {
      stalled: false,
      reason: "output-gap-below-threshold",
    };
  }
  const ratio = outputGapMinutes / Math.max(runtimeMinutes, 1);
  if (ratio < policy.min_gap_runtime_ratio) {
    return {
      stalled: false,
      reason: "gap-ratio-below-threshold",
    };
  }
  if (
    thread.last_output_wait_hint &&
    !thread.user_turn_after_last_output
  ) {
    const waitHintGraceMinutes = effectiveWaitHintGraceMinutes(thread, policy);
    if (outputGapMinutes < waitHintGraceMinutes) {
      return {
        stalled: false,
        reason: `waiting-hint-grace-window(${waitHintGraceMinutes.toFixed(1)}m)`,
      };
    }
  }
  if (thread.last_output_wait_hint && thread.user_turn_after_last_output) {
    return {
      stalled: false,
      reason: "waiting-hint-user-followup",
    };
  }
  if (requireLikelyActive && !isLikelyActiveThread(thread)) {
    return {
      stalled: false,
      reason: "thread-not-likely-active",
    };
  }
  return {
    stalled: true,
    reason: `runtime=${runtimeMinutes.toFixed(1)}m gap=${outputGapMinutes.toFixed(1)}m ratio=${ratio.toFixed(2)}`,
  };
}

function minutesSince(isoUtc: string | null | undefined, nowMs: number): number | null {
  const parsed = parseTimestampMs(isoUtc);
  if (parsed === null || nowMs < parsed) {
    return null;
  }
  return (nowMs - parsed) / 60000;
}

function parseThreadId(value: unknown): string | null {
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
  return null;
}

function formatList(values: unknown[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return "none";
  }
  const lines = values
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => `- ${value}`);
  return lines.length > 0 ? lines.join("\n") : "none";
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => Boolean(value));
}

function compactIsoForTag(isoUtc: string): string {
  return isoUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => normalizeOptionalText(tag)).filter((tag): tag is string => Boolean(tag)))];
}

function mergeImplementationNotes(existing: unknown, appendedLine: string): string {
  const current = normalizeOptionalText(existing);
  if (!current) {
    return appendedLine;
  }
  return `${current}\n${appendedLine}`;
}

function projectNameFromOptions(repoRoot: string, explicitProjectName: string | null | undefined): string {
  const explicit = normalizeOptionalText(explicitProjectName);
  if (explicit) {
    return explicit;
  }
  const basename = normalizeOptionalText(path.basename(repoRoot));
  return basename || "project";
}

function buildWorkerRecoveryPrompt(options: {
  projectName: string;
  task: Partial<TaskRecord>;
  taskId: string;
  stalledThread: ParsedThreadSummary;
  reason: string;
  recoveredAtUtc: string;
  oldThreadId: string;
  newThreadId: string;
}): string {
  return [
    `Watchdog recovery: this worker execution stalled and was deterministically reset.`,
    `Project: ${options.projectName}`,
    `Task ID: ${options.taskId}`,
    `Task title: ${normalizeOptionalText(options.task.title) || "Untitled task"}`,
    `Stalled thread: ${options.oldThreadId}`,
    `Recovery thread: ${options.newThreadId}`,
    `Recovered at UTC: ${options.recoveredAtUtc}`,
    `Stall reason: ${options.reason}`,
    "",
    "Continue and complete the task using the existing TaskNerve task contract below.",
    "",
    `Objective: ${normalizeOptionalText(options.task.objective) || "none"}`,
    `Files in scope:\n${formatList(options.task.files_in_scope)}`,
    `Out of scope:\n${formatList(options.task.out_of_scope)}`,
    `Acceptance criteria:\n${formatList(options.task.acceptance_criteria)}`,
    `Deliverables:\n${formatList(options.task.deliverables)}`,
    `Verification steps:\n${formatList(options.task.verification_steps)}`,
    `Implementation notes: ${normalizeOptionalText(options.task.implementation_notes) || "none"}`,
    "",
    "Do not request user git intervention. Continue deterministically and report concrete progress.",
  ].join("\n");
}

function buildControllerRecoveryPrompt(options: {
  projectName: string;
  repoRoot: string;
  reason: string;
  stalledThreadId: string;
  recoveredAtUtc: string;
  taskNerve: TaskNerveService;
}): string {
  const base = options.taskNerve.buildControllerPrompt({
    projectName: options.projectName,
    repoRoot: options.repoRoot,
    queueSummary: "Watchdog controller recovery in progress",
    currentStateSignals: [
      `Controller thread ${options.stalledThreadId} was reset by deterministic watchdog`,
      `Recovery reason: ${options.reason}`,
      `Recovered at UTC: ${options.recoveredAtUtc}`,
    ],
  });
  return `${base}\n\nWatchdog recovery note: controller was reset due to sustained output stall. Resume orchestration immediately.`;
}

export async function runCodexAgentWatchdog(
  dependencies: CodexAgentWatchdogDependencies,
  options: CodexAgentWatchdogRunOptions,
): Promise<CodexAgentWatchdogRunResult> {
  const checkedAtUtc = normalizeOptionalText(options.nowIsoUtc) || nowIsoUtc();
  const checkedAtMs = Date.parse(checkedAtUtc);
  const nowMs = Number.isFinite(checkedAtMs) ? checkedAtMs : Date.now();
  const policy = normalizePolicy(options.policy);
  const projectName = projectNameFromOptions(options.repoRoot, options.projectName);
  const warnings: string[] = [];
  const actions: CodexAgentWatchdogAction[] = [];
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];

  if (!policy.enabled) {
    return {
      integration_mode: "codex-native-host",
      repo_root: options.repoRoot,
      project_name: projectName,
      checked_at_utc: checkedAtUtc,
      policy,
      threads_seen: 0,
      threads_scanned: 0,
      stalled_worker_candidates: 0,
      stalled_controller_candidates: 0,
      worker_resets: 0,
      controller_resets: 0,
      recovered_task_ids: [],
      actions,
      warnings,
    };
  }

  const threadsPayload =
    options.threadsPayload !== undefined
      ? options.threadsPayload
      : await Promise.resolve(dependencies.host.listProjectThreads());
  const threadRecords = parseThreadList(threadsPayload);
  const parsedThreads = threadRecords
    .map((record) => parseThreadSummary(record, nowMs))
    .filter((entry): entry is ParsedThreadSummary => entry !== null);
  const newestByAgent = selectNewestThreadByAgent(parsedThreads);
  const claimedTasks = parseClaimedTasks(tasks);
  const settings = dependencies.taskNerve.normalizeProjectSettings(options.settings);
  const state = await loadProjectAgentWatchdogState(options.repoRoot);
  let nextState: ProjectAgentWatchdogState = {
    ...state,
    updated_at_utc: checkedAtUtc,
    last_recovery_by_task: { ...state.last_recovery_by_task },
    last_recovery_by_thread: { ...state.last_recovery_by_thread },
  };
  let stateDirty = false;
  let resetsRemaining = policy.max_resets_per_run;
  let stalledWorkerCandidates = 0;
  let stalledControllerCandidates = 0;
  const recoveredTaskIds: string[] = [];
  const upsertTasks: Partial<TaskRecord>[] = [];

  for (const claimed of claimedTasks) {
    if (resetsRemaining <= 0) {
      break;
    }
    const thread = newestByAgent.get(claimed.agent_id);
    if (!thread || thread.scope === "other") {
      continue;
    }
    const stalled = isThreadStalled(thread, policy, false);
    if (!stalled.stalled) {
      continue;
    }
    stalledWorkerCandidates += 1;
    if (thread.scope === "controller" || claimed.agent_id === CONTROLLER_AGENT_ID) {
      continue;
    }
    const sinceTaskRecoveryMinutes = minutesSince(
      nextState.last_recovery_by_task[claimed.task_id],
      nowMs,
    );
    if (
      sinceTaskRecoveryMinutes !== null &&
      sinceTaskRecoveryMinutes < policy.task_recovery_cooldown_minutes
    ) {
      continue;
    }
    const sinceThreadRecoveryMinutes = minutesSince(
      nextState.last_recovery_by_thread[thread.thread_id],
      nowMs,
    );
    if (
      sinceThreadRecoveryMinutes !== null &&
      sinceThreadRecoveryMinutes < policy.task_recovery_cooldown_minutes
    ) {
      continue;
    }
    if (typeof dependencies.host.startThread !== "function" || typeof dependencies.host.startTurn !== "function") {
      warnings.push("Worker watchdog reset skipped: required host methods startThread/startTurn are unavailable");
      continue;
    }

    const recoveryTitle = `${claimed.agent_id} watchdog recovery`;
    try {
      const threadPayload = await dependencies.host.startThread({
        title: recoveryTitle,
        role: "agent",
        agent_id: claimed.agent_id,
        metadata: {
          source: "tasknerve.watchdog",
          repo_root: options.repoRoot,
          project_name: projectName,
          task_id: claimed.task_id,
          stalled_thread_id: thread.thread_id,
          recovered_at_utc: checkedAtUtc,
        },
      });
      const recoveryThreadId = parseThreadId(threadPayload);
      if (!recoveryThreadId) {
        warnings.push(`Worker watchdog reset skipped for ${claimed.agent_id}: startThread returned no thread id`);
        continue;
      }

      if (typeof dependencies.host.setThreadName === "function") {
        await dependencies.host.setThreadName(recoveryThreadId, recoveryTitle);
      }
      const workerModel = dependencies.taskNerve.resolveModelsForTask(settings, claimed.task).worker_model;
      if (workerModel && typeof dependencies.host.setThreadModel === "function") {
        await dependencies.host.setThreadModel(recoveryThreadId, workerModel);
      }
      const prompt = buildWorkerRecoveryPrompt({
        projectName,
        task: claimed.task,
        taskId: claimed.task_id,
        stalledThread: thread,
        reason: stalled.reason,
        recoveredAtUtc: checkedAtUtc,
        oldThreadId: thread.thread_id,
        newThreadId: recoveryThreadId,
      });
      await dependencies.host.startTurn({
        thread_id: recoveryThreadId,
        threadId: recoveryThreadId,
        agent_id: claimed.agent_id,
        model: workerModel ?? undefined,
        prompt,
      });
      if (typeof dependencies.host.setThreadName === "function") {
        const retiredTitle = `${thread.title || claimed.agent_id} [stalled-reset ${checkedAtUtc}]`;
        try {
          await dependencies.host.setThreadName(thread.thread_id, retiredTitle);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Failed to label stalled thread ${thread.thread_id}: ${message}`);
        }
      }

      const existingTags = normalizeStringArray(claimed.task.tags);
      const recoveredTag = `watchdog-recovered-at:${compactIsoForTag(checkedAtUtc)}`;
      upsertTasks.push({
        ...claimed.task,
        task_id: claimed.task_id,
        title: claimed.title,
        status: "claimed",
        ready: true,
        claimed_by_agent_id: claimed.agent_id,
        tags: uniqueTags([...existingTags, "watchdog-recovered", recoveredTag]),
        implementation_notes: mergeImplementationNotes(
          claimed.task.implementation_notes,
          `Watchdog reset at ${checkedAtUtc}; stalled thread=${thread.thread_id}; recovery thread=${recoveryThreadId}; reason=${stalled.reason}`,
        ),
      });
      actions.push({
        type: "worker-reset",
        agent_id: claimed.agent_id,
        stalled_thread_id: thread.thread_id,
        recovery_thread_id: recoveryThreadId,
        task_id: claimed.task_id,
        reason: stalled.reason,
      });
      recoveredTaskIds.push(claimed.task_id);
      nextState.last_recovery_by_task[claimed.task_id] = checkedAtUtc;
      nextState.last_recovery_by_thread[thread.thread_id] = checkedAtUtc;
      stateDirty = true;
      resetsRemaining -= 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Worker watchdog reset failed for ${claimed.agent_id}/${claimed.task_id}: ${message}`);
    }
  }

  const controllerThread = parsedThreads.find((thread) => thread.scope === "controller") || null;
  if (controllerThread) {
    const controllerStalled = isThreadStalled(controllerThread, policy, true);
    if (controllerStalled.stalled) {
      stalledControllerCandidates += 1;
      const sinceControllerResetMinutes = minutesSince(nextState.controller_last_reset_at_utc, nowMs);
      if (
        resetsRemaining > 0 &&
        (sinceControllerResetMinutes === null ||
          sinceControllerResetMinutes >= policy.controller_recovery_cooldown_minutes)
      ) {
        if (
          typeof dependencies.host.startThread === "function" &&
          typeof dependencies.host.startTurn === "function"
        ) {
          const controllerTitle = `${projectName} TaskNerve Controller (watchdog recovery)`;
          try {
            const controllerPayload = await dependencies.host.startThread({
              title: controllerTitle,
              role: "controller",
              agent_id: CONTROLLER_AGENT_ID,
              metadata: {
                source: "tasknerve.watchdog",
                repo_root: options.repoRoot,
                project_name: projectName,
                stalled_thread_id: controllerThread.thread_id,
                recovered_at_utc: checkedAtUtc,
              },
            });
            const recoveryControllerThreadId = parseThreadId(controllerPayload);
            if (!recoveryControllerThreadId) {
              warnings.push("Controller watchdog reset skipped: startThread returned no thread id");
            } else {
              if (typeof dependencies.host.setThreadName === "function") {
                await dependencies.host.setThreadName(recoveryControllerThreadId, controllerTitle);
              }
              const controllerModel = dependencies.taskNerve.resolveModelsForTask(settings).controller_model;
              if (controllerModel && typeof dependencies.host.setThreadModel === "function") {
                await dependencies.host.setThreadModel(recoveryControllerThreadId, controllerModel);
              }
              await dependencies.host.startTurn({
                thread_id: recoveryControllerThreadId,
                threadId: recoveryControllerThreadId,
                agent_id: CONTROLLER_AGENT_ID,
                model: controllerModel ?? undefined,
                prompt: buildControllerRecoveryPrompt({
                  projectName,
                  repoRoot: options.repoRoot,
                  reason: controllerStalled.reason,
                  stalledThreadId: controllerThread.thread_id,
                  recoveredAtUtc: checkedAtUtc,
                  taskNerve: dependencies.taskNerve,
                }),
              });
              if (typeof dependencies.host.setThreadName === "function") {
                const retiredTitle = `${controllerThread.title || "TaskNerve Controller"} [stalled-reset ${checkedAtUtc}]`;
                try {
                  await dependencies.host.setThreadName(controllerThread.thread_id, retiredTitle);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  warnings.push(
                    `Failed to label stalled controller thread ${controllerThread.thread_id}: ${message}`,
                  );
                }
              }
              nextState.controller_last_reset_at_utc = checkedAtUtc;
              nextState.last_recovery_by_thread[controllerThread.thread_id] = checkedAtUtc;
              stateDirty = true;
              resetsRemaining -= 1;
              actions.push({
                type: "controller-reset",
                agent_id: CONTROLLER_AGENT_ID,
                stalled_thread_id: controllerThread.thread_id,
                recovery_thread_id: recoveryControllerThreadId,
                task_id: null,
                reason: controllerStalled.reason,
              });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Controller watchdog reset failed: ${message}`);
          }
        } else {
          warnings.push(
            "Controller watchdog reset skipped: required host methods startThread/startTurn are unavailable",
          );
        }
      }
    }
  }

  if (upsertTasks.length > 0) {
    if (typeof dependencies.host.upsertTaskNerveProjectTasks === "function") {
      try {
        await dependencies.host.upsertTaskNerveProjectTasks({
          repoRoot: options.repoRoot,
          tasks: upsertTasks,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to persist watchdog task assignment updates: ${message}`);
      }
    } else {
      warnings.push(
        "Watchdog could not persist task assignment updates because upsertTaskNerveProjectTasks is unavailable",
      );
    }
  }

  if (stateDirty) {
    try {
      nextState = await writeProjectAgentWatchdogState(options.repoRoot, nextState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to persist watchdog state: ${message}`);
    }
  }

  return {
    integration_mode: "codex-native-host",
    repo_root: options.repoRoot,
    project_name: projectName,
    checked_at_utc: checkedAtUtc,
    policy,
    threads_seen: threadRecords.length,
    threads_scanned: parsedThreads.length,
    stalled_worker_candidates: stalledWorkerCandidates,
    stalled_controller_candidates: stalledControllerCandidates,
    worker_resets: actions.filter((entry) => entry.type === "worker-reset").length,
    controller_resets: actions.filter((entry) => entry.type === "controller-reset").length,
    recovered_task_ids: recoveredTaskIds,
    actions,
    warnings,
  };
}
