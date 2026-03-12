import { nowIsoUtc } from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { normalizeProjectCodexSettings } from "./projectCodexSettings.js";

const AUTO_IMPROVE_TAG_PREFIX = "auto-improve-key:";
const AUTO_IMPROVE_TAG = "tasknerve:auto-improve";

type ImprovementSignalId = "watchdog-resets" | "quality-gate-blocked" | "git-sync-instability";

export interface ProjectSelfImprovementGitIssueSignal {
  key: string;
  phase: string;
  summary: string;
  detail?: string;
}

export interface ProjectSelfImprovementWatchdogSignal {
  worker_resets?: number | null;
  controller_resets?: number | null;
  stalled_worker_candidates?: number | null;
  stalled_controller_candidates?: number | null;
}

export interface BuildProjectSelfImprovementPlanOptions {
  settings: Partial<ProjectCodexSettings>;
  tasks?: Partial<TaskRecord>[];
  warnings?: string[];
  git_issues?: ProjectSelfImprovementGitIssueSignal[];
  watchdog?: ProjectSelfImprovementWatchdogSignal | null;
  now_iso?: string;
}

export interface ProjectSelfImprovementTaskUpsert {
  action: "create" | "reopen";
  key: ImprovementSignalId;
  task: TaskRecord;
}

export interface ProjectSelfImprovementPlan {
  integration_mode: "codex-native-host";
  generated_at_utc: string;
  policy: {
    enabled: boolean;
    auto_dispatch_enabled: boolean;
    max_tasks_per_run: number;
    open_task_limit: number;
    dispatch_cooldown_minutes: number;
    last_dispatch_at_utc: string | null;
  };
  signals: {
    watchdog_reset_count: number;
    quality_gate_block_warning_count: number;
    git_issue_count: number;
  };
  task_upserts: ProjectSelfImprovementTaskUpsert[];
  dispatch_task_ids: string[];
  blocked_by_cooldown: boolean;
  skipped_reason: string | null;
}

interface ImprovementCandidate {
  key: ImprovementSignalId;
  title: string;
  objective: string;
  subsystem: string;
  priority: number;
  files_in_scope: string[];
  acceptance_criteria: string[];
  deliverables: string[];
  verification_steps: string[];
  implementation_notes: string;
  risk_notes: string[];
  evidence: string[];
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(Number(value))));
}

function toIsoNow(value: unknown): string {
  return normalizeOptionalText(value) || nowIsoUtc();
}

function minutesSince(last: string | null, nowIso: string): number | null {
  if (!last) {
    return null;
  }
  const from = Date.parse(last);
  const to = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  return (to - from) / 60_000;
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function taskIdForKey(key: ImprovementSignalId): string {
  return `auto-improve-${fnv1aHex(`tasknerve:${key}`)}`;
}

function extractAutoImproveKey(task: Partial<TaskRecord>): string | null {
  if (!Array.isArray(task.tags)) {
    return null;
  }
  for (const rawTag of task.tags) {
    const tag = normalizeOptionalText(rawTag);
    if (!tag || !tag.startsWith(AUTO_IMPROVE_TAG_PREFIX)) {
      continue;
    }
    return tag.slice(AUTO_IMPROVE_TAG_PREFIX.length).trim().toLowerCase() || null;
  }
  return null;
}

function isActiveTaskStatus(status: unknown): boolean {
  const normalized = normalizeOptionalText(status)?.toLowerCase();
  return normalized === "open" || normalized === "claimed" || normalized === "blocked";
}

function hasQualityGateBlockWarning(warnings: string[]): number {
  let count = 0;
  for (const warning of warnings) {
    const normalized = warning.toLowerCase();
    if (normalized.includes("task quality gate blocked")) {
      count += 1;
    }
  }
  return count;
}

function buildWatchdogCandidate(signal: {
  watchdog_reset_count: number;
  watchdog_worker_resets: number;
  watchdog_controller_resets: number;
}): ImprovementCandidate | null {
  if (signal.watchdog_reset_count <= 0) {
    return null;
  }
  return {
    key: "watchdog-resets",
    title: "Reduce watchdog resets and stall churn",
    objective:
      "Restore steady-state thread execution so deterministic watchdog resets trend back to zero.",
    subsystem: "runtime.watchdog",
    priority: 9,
    files_in_scope: [
      "codex-native/src/integration/codexAgentWatchdog.ts",
      "codex-native/src/integration/codexProjectProductionRuntime.ts",
      "codex-native/test/codexTaskNerveHostRuntime.test.ts",
    ],
    acceptance_criteria: [
      "Watchdog resets are reduced versus current baseline while preserving deterministic recovery behavior.",
      "Waiting-hint grace behavior remains intact for long-running jobs.",
      "Watchdog tests pass without regressions.",
    ],
    deliverables: [
      "Root-cause writeup for reset source(s).",
      "Deterministic mitigation patch with test coverage.",
    ],
    verification_steps: [
      "Run targeted watchdog tests in codex-native test suite.",
      "Run one production sync cycle and confirm reset counters trend downward.",
    ],
    implementation_notes:
      "Focus on deterministic heuristics and guardrails; avoid introducing AI-dependent stall detection.",
    risk_notes: [
      "Overly aggressive reset suppression can hide true stalls.",
      "Overly aggressive reset behavior can cause context churn.",
    ],
    evidence: [
      `worker_resets=${signal.watchdog_worker_resets}`,
      `controller_resets=${signal.watchdog_controller_resets}`,
    ],
  };
}

function buildQualityGateCandidate(blockCount: number): ImprovementCandidate | null {
  if (blockCount <= 0) {
    return null;
  }
  return {
    key: "quality-gate-blocked",
    title: "Eliminate task quality-gate dispatch blocks",
    objective:
      "Raise controller task quality so dispatches pass deterministic quality gates without manual rework.",
    subsystem: "controller.task-quality",
    priority: 8,
    files_in_scope: [
      "codex-native/src/domain/taskQueue.ts",
      "codex-native/src/domain/controllerBootstrap.ts",
      "skills/tasknerve/SKILL.md",
    ],
    acceptance_criteria: [
      "New controller tasks consistently include required quality fields.",
      "Quality-gate blocked dispatch count trends to zero for regular sync cycles.",
      "Quality-gate tests pass.",
    ],
    deliverables: [
      "Controller task-template improvements aligned with gate scoring.",
      "Tests or fixtures proving low-quality tasks are prevented.",
    ],
    verification_steps: [
      "Run taskQueue quality tests.",
      "Run a production sync fixture and verify no quality-gate block warnings for compliant tasks.",
    ],
    implementation_notes:
      "Prefer template and deterministic validation improvements over ad-hoc per-task patching.",
    risk_notes: [
      "Over-constraining templates can slow urgent dispatches.",
      "Changing quality gate scoring can impact CI task behavior if toggled on.",
    ],
    evidence: [`quality_gate_block_warning_count=${blockCount}`],
  };
}

function buildGitSyncCandidate(gitIssueCount: number): ImprovementCandidate | null {
  if (gitIssueCount <= 0) {
    return null;
  }
  return {
    key: "git-sync-instability",
    title: "Stabilize deterministic git auto-sync reliability",
    objective:
      "Reduce recurring git sync failures so pull/push remains extrapolated away from users.",
    subsystem: "runtime.git-sync",
    priority: 8,
    files_in_scope: [
      "codex-native/src/integration/codexProjectProductionRuntime.ts",
      "codex-native/src/integration/codexGitIssueRemediation.ts",
      "codex-native/src/domain/projectGitSync.ts",
    ],
    acceptance_criteria: [
      "Repeated pull/push policy failures are reduced versus baseline.",
      "Git remediation tasks remain deterministic and high-quality.",
      "Git sync tests pass.",
    ],
    deliverables: [
      "Mitigation patch for highest-frequency git failure path.",
      "Verification evidence from production sync flow.",
    ],
    verification_steps: [
      "Run project production runtime tests covering git sync/remediation.",
      "Confirm warnings no longer include the targeted git failure signature.",
    ],
    implementation_notes:
      "Prioritize deterministic policy fixes and host integration checks before adding new automation.",
    risk_notes: [
      "Auto-sync behavior differs per repo policy and branch constraints.",
      "Incorrect retries can amplify git contention.",
    ],
    evidence: [`git_issue_count=${gitIssueCount}`],
  };
}

function buildTaskFromCandidate(
  candidate: ImprovementCandidate,
  nowIso: string,
  existingTaskId: string | null,
): TaskRecord {
  const lines = [
    "Autogenerated by TaskNerve deterministic self-improvement loop.",
    `Signal: ${candidate.key}`,
    ...candidate.evidence.map((entry) => `- ${entry}`),
    "",
    "Apply an autoresearch-style keep/discard iteration:",
    "1. define baseline metric",
    "2. implement one scoped change set",
    "3. verify metric delta and keep only proven improvements",
  ];
  return {
    task_id: existingTaskId || taskIdForKey(candidate.key),
    title: candidate.title,
    detail: lines.join("\n"),
    objective: candidate.objective,
    task_type: "maintenance",
    subsystem: candidate.subsystem,
    priority: candidate.priority,
    tags: [
      AUTO_IMPROVE_TAG,
      `auto-improve:${candidate.key}`,
      `${AUTO_IMPROVE_TAG_PREFIX}${candidate.key}`,
      "deterministic-loop",
      "autoresearch-inspired",
    ],
    depends_on: [],
    files_in_scope: candidate.files_in_scope,
    out_of_scope: [
      "Non-deterministic AI-only orchestration behavior",
      "Cross-platform support changes outside active runtime target",
    ],
    acceptance_criteria: candidate.acceptance_criteria,
    deliverables: candidate.deliverables,
    verification_steps: candidate.verification_steps,
    implementation_notes: `${candidate.implementation_notes}\n\nGenerated at ${nowIso}.`,
    risk_notes: candidate.risk_notes,
    estimated_effort: "s",
    status: "open",
    ready: true,
    claimed_by_agent_id: null,
    suggested_intelligence: "high",
    suggested_model: null,
  };
}

export function buildProjectSelfImprovementPlan(
  options: BuildProjectSelfImprovementPlanOptions,
): ProjectSelfImprovementPlan {
  const nowIso = toIsoNow(options.now_iso);
  const settings = normalizeProjectCodexSettings(options.settings || {});
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const warnings = Array.isArray(options.warnings) ? options.warnings : [];
  const gitIssues = Array.isArray(options.git_issues) ? options.git_issues : [];
  const watchdogWorkerResets = normalizeInt(options.watchdog?.worker_resets, 0, 0, 10_000);
  const watchdogControllerResets = normalizeInt(options.watchdog?.controller_resets, 0, 0, 10_000);
  const watchdogResetCount = watchdogWorkerResets + watchdogControllerResets;
  const qualityGateBlockWarningCount = hasQualityGateBlockWarning(warnings);
  const gitIssueCount = gitIssues.length;

  const policy = {
    enabled: settings.self_improvement_enabled,
    auto_dispatch_enabled: settings.self_improvement_auto_dispatch_enabled,
    max_tasks_per_run: settings.self_improvement_max_tasks_per_run,
    open_task_limit: settings.self_improvement_open_task_limit,
    dispatch_cooldown_minutes: settings.self_improvement_dispatch_cooldown_minutes,
    last_dispatch_at_utc: normalizeOptionalText(settings.self_improvement_last_dispatch_at_utc),
  };

  const basePlan: ProjectSelfImprovementPlan = {
    integration_mode: "codex-native-host",
    generated_at_utc: nowIso,
    policy,
    signals: {
      watchdog_reset_count: watchdogResetCount,
      quality_gate_block_warning_count: qualityGateBlockWarningCount,
      git_issue_count: gitIssueCount,
    },
    task_upserts: [],
    dispatch_task_ids: [],
    blocked_by_cooldown: false,
    skipped_reason: null,
  };

  if (!policy.enabled) {
    return {
      ...basePlan,
      skipped_reason: "self-improvement-disabled",
    };
  }

  const activeAutoImproveCount = tasks.reduce((count, task) => {
    if (!extractAutoImproveKey(task) || !isActiveTaskStatus(task.status)) {
      return count;
    }
    return count + 1;
  }, 0);

  const keyedTasks = new Map<string, Partial<TaskRecord>>();
  for (const task of tasks) {
    const key = extractAutoImproveKey(task);
    if (!key || keyedTasks.has(key)) {
      continue;
    }
    keyedTasks.set(key, task);
  }

  const candidates = [
    buildWatchdogCandidate({
      watchdog_reset_count: watchdogResetCount,
      watchdog_worker_resets: watchdogWorkerResets,
      watchdog_controller_resets: watchdogControllerResets,
    }),
    buildQualityGateCandidate(qualityGateBlockWarningCount),
    buildGitSyncCandidate(gitIssueCount),
  ].filter((candidate): candidate is ImprovementCandidate => candidate !== null);

  let createdThisRun = 0;
  let activeCountProjected = activeAutoImproveCount;
  const upserts: ProjectSelfImprovementTaskUpsert[] = [];
  const dispatchCandidates: string[] = [];

  for (const candidate of candidates) {
    const existing = keyedTasks.get(candidate.key);
    const existingTaskId = normalizeOptionalText(existing?.task_id);
    if (existing && normalizeOptionalText(existing.status)?.toLowerCase() === "done") {
      const reopenTask = buildTaskFromCandidate(candidate, nowIso, existingTaskId);
      upserts.push({
        action: "reopen",
        key: candidate.key,
        task: reopenTask,
      });
      dispatchCandidates.push(reopenTask.task_id);
      continue;
    }
    if (existing) {
      continue;
    }
    if (createdThisRun >= policy.max_tasks_per_run) {
      continue;
    }
    if (activeCountProjected >= policy.open_task_limit) {
      continue;
    }
    const createTask = buildTaskFromCandidate(candidate, nowIso, existingTaskId);
    upserts.push({
      action: "create",
      key: candidate.key,
      task: createTask,
    });
    dispatchCandidates.push(createTask.task_id);
    createdThisRun += 1;
    activeCountProjected += 1;
  }

  const minutesFromLastDispatch = minutesSince(policy.last_dispatch_at_utc, nowIso);
  const blockedByCooldown =
    minutesFromLastDispatch !== null &&
    minutesFromLastDispatch < policy.dispatch_cooldown_minutes;

  return {
    ...basePlan,
    task_upserts: upserts,
    dispatch_task_ids:
      policy.auto_dispatch_enabled && !blockedByCooldown ? dispatchCandidates : [],
    blocked_by_cooldown: blockedByCooldown,
    skipped_reason:
      upserts.length === 0
        ? "no-actionable-signals"
        : blockedByCooldown
          ? "dispatch-cooldown-active"
          : null,
  };
}

export function projectSettingsAfterSelfImprovementDispatch(options: {
  settings: Partial<ProjectCodexSettings>;
  dispatched_task_count: number;
  dispatched_at_utc?: string;
}): ProjectCodexSettings {
  const normalized = normalizeProjectCodexSettings(options.settings || {});
  const dispatchCount = normalizeInt(options.dispatched_task_count, 0, 0, 10_000);
  if (dispatchCount <= 0) {
    return normalized;
  }
  return normalizeProjectCodexSettings({
    ...normalized,
    self_improvement_last_dispatch_at_utc:
      normalizeOptionalText(options.dispatched_at_utc) || nowIsoUtc(),
  });
}
