import { CONTROLLER_AGENT_ID, nowIsoUtc } from "../constants.js";
import type { CodexHostServices } from "../host/codexHostServices.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { dispatchTaskNerveTasksWithPolicy } from "./codexTaskDispatchRuntime.js";
import type { TaskNerveService } from "./taskNerveService.js";

const GIT_REMEDIATION_TASK_ID = "task.git-remediation.controller";
const GIT_REMEDIATION_TAG = "git-remediation";
const GIT_REMEDIATION_FINGERPRINT_PREFIX = "git-remediation-fp:";
const GIT_ISSUE_TAG_PREFIX = "git-issue:";

export type GitIssuePhase = "branch-switch" | "pull" | "push" | "policy";

export interface GitIssueSignal {
  key: string;
  phase: GitIssuePhase;
  summary: string;
  detail?: string | null;
}

export interface EscalateGitIssuesToControllerOptions {
  host: CodexHostServices;
  taskNerve: TaskNerveService;
  repoRoot: string;
  nowIsoUtc?: string | null;
  settings: Partial<ProjectCodexSettings>;
  tasks?: Partial<TaskRecord>[];
  issues: GitIssueSignal[];
}

export interface EscalateGitIssuesToControllerResult {
  task_id: string | null;
  issue_count: number;
  persisted: boolean;
  dispatched: boolean;
  skipped: boolean;
  warnings: string[];
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeOptionalText(entry))
    .filter((entry): entry is string => entry !== null);
}

function sanitizeTagValue(value: string, fallback = "unknown"): string {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._:/-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uniqueSortedTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => normalizeOptionalText(tag)).filter((tag): tag is string => Boolean(tag)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeStatus(value: unknown): "open" | "claimed" | "blocked" | "done" {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (normalized === "claimed" || normalized === "blocked" || normalized === "done") {
    return normalized;
  }
  return "open";
}

function isActiveStatus(value: unknown): boolean {
  const status = normalizeStatus(value);
  return status === "open" || status === "claimed" || status === "blocked";
}

function dedupeIssues(issues: GitIssueSignal[]): GitIssueSignal[] {
  const byKey = new Map<string, GitIssueSignal>();
  for (const issue of issues) {
    const key = normalizeOptionalText(issue.key);
    const summary = normalizeOptionalText(issue.summary);
    if (!key || !summary) {
      continue;
    }
    byKey.set(key, {
      key,
      phase: issue.phase,
      summary,
      detail: normalizeOptionalText(issue.detail),
    });
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function projectNameFromRepoRoot(repoRoot: string): string {
  const normalized = repoRoot.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "project";
  }
  return segments[segments.length - 1] || "project";
}

function findExistingRemediationTask(tasks: Partial<TaskRecord>[]): Partial<TaskRecord> | null {
  for (const task of tasks) {
    const taskId = normalizeOptionalText(task.task_id);
    if (taskId && taskId === GIT_REMEDIATION_TASK_ID) {
      return task;
    }
  }
  for (const task of tasks) {
    const tags = normalizeStringArray(task.tags);
    if (tags.some((tag) => tag === GIT_REMEDIATION_TAG)) {
      return task;
    }
  }
  return null;
}

function extractFingerprintTag(task: Partial<TaskRecord> | null): string | null {
  if (!task) {
    return null;
  }
  const tags = normalizeStringArray(task.tags);
  for (const tag of tags) {
    if (tag.startsWith(GIT_REMEDIATION_FINGERPRINT_PREFIX)) {
      return tag.slice(GIT_REMEDIATION_FINGERPRINT_PREFIX.length) || null;
    }
  }
  return null;
}

function renderIssueDetailLines(issues: GitIssueSignal[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    lines.push(`- [${issue.phase}] ${issue.summary}`);
    if (issue.detail) {
      lines.push(`  ${issue.detail}`);
    }
  }
  return lines;
}

function buildRemediationTask(options: {
  repoRoot: string;
  settings: Partial<ProjectCodexSettings>;
  issues: GitIssueSignal[];
  fingerprint: string;
  generatedAtUtc: string;
  previousTask: Partial<TaskRecord> | null;
  taskNerve: TaskNerveService;
}): TaskRecord {
  const projectName = projectNameFromRepoRoot(options.repoRoot);
  const previousPriorityRaw = Number(options.previousTask?.priority);
  const previousPriority = Number.isFinite(previousPriorityRaw)
    ? Math.max(0, Math.round(previousPriorityRaw))
    : 0;
  const previousStatus = normalizeStatus(options.previousTask?.status);
  const controllerModel = options.taskNerve.resolveModelsForTask(options.settings).controller_model;
  const issueKeys = options.issues.map((issue) => issue.key).join(", ");
  const issueSummary = renderIssueDetailLines(options.issues);

  return {
    task_id: GIT_REMEDIATION_TASK_ID,
    title: `Stabilize TaskNerve git automation for ${projectName}`,
    detail: [
      "TaskNerve detected git automation issues that should remain abstracted away from the user.",
      `Detected at: ${options.generatedAtUtc}`,
      "Detected issues:",
      ...issueSummary,
      "",
      "Controller expectations:",
      "1. Diagnose and remediate the git issue(s) deterministically inside TaskNerve-managed flow.",
      "2. Avoid asking the user to run git commands manually unless absolutely unavoidable.",
      "3. If remediation is blocked by external constraints, capture a deterministic follow-up plan.",
    ].join("\n"),
    objective:
      "Restore healthy TaskNerve-managed git sync so pull/push/branch automation works without direct user git intervention.",
    task_type: "ops",
    subsystem: "git-sync",
    priority: Math.max(10, previousPriority),
    tags: uniqueSortedTags([
      GIT_REMEDIATION_TAG,
      "controller",
      "git",
      "ops",
      `${GIT_REMEDIATION_FINGERPRINT_PREFIX}${options.fingerprint}`,
      ...options.issues.map((issue) => `${GIT_ISSUE_TAG_PREFIX}${sanitizeTagValue(issue.key)}`),
    ]),
    depends_on: [],
    files_in_scope: [".git", ".tasknerve", "taskNerve"],
    out_of_scope: [
      "Manual user git intervention unless deterministic automation is impossible",
      "Unrelated feature work",
    ],
    acceptance_criteria: [
      "TaskNerve git sync operations complete without the detected failure signatures.",
      "Any required branch/remote/policy updates are applied and documented.",
      "User does not need to run ad-hoc git commands for this remediation path.",
    ],
    deliverables: [
      "Root cause and remediation actions documented in this task.",
      "Repository/TaskNerve configuration updated if required.",
      "Follow-up task(s) added only if additional deterministic work remains.",
    ],
    verification_steps: [
      "Run TaskNerve git sync in smart mode and verify no matching git issue is emitted.",
      "Confirm repository git state is healthy (branch, remote, working tree, ahead/behind).",
      "Confirm this remediation task no longer regenerates with the same fingerprint.",
    ],
    implementation_notes: [
      `Controller remediation fingerprint: ${options.fingerprint}`,
      `Controller issue keys: ${issueKeys || "none"}`,
    ].join("\n"),
    risk_notes: [
      "Incorrect git remediation can desynchronize automated push cadence.",
      "Branch/policy misconfiguration may repeatedly block autonomous sync.",
    ],
    estimated_effort: options.issues.length > 2 ? "m" : "s",
    status: previousStatus === "blocked" ? "blocked" : "claimed",
    ready: true,
    claimed_by_agent_id: CONTROLLER_AGENT_ID,
    suggested_intelligence: "high",
    suggested_model: controllerModel ?? undefined,
  };
}

export async function escalateGitIssuesToController(
  options: EscalateGitIssuesToControllerOptions,
): Promise<EscalateGitIssuesToControllerResult> {
  const normalizedIssues = dedupeIssues(Array.isArray(options.issues) ? options.issues : []);
  if (normalizedIssues.length === 0) {
    return {
      task_id: null,
      issue_count: 0,
      persisted: false,
      dispatched: false,
      skipped: true,
      warnings: [],
    };
  }

  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const previousTask = findExistingRemediationTask(tasks);
  const fingerprintInput = normalizedIssues
    .map((issue) => `${issue.key}|${issue.phase}|${issue.summary}|${issue.detail || ""}`)
    .join("\n");
  const fingerprint = stableFingerprint(fingerprintInput);
  const previousFingerprint = extractFingerprintTag(previousTask);
  const previousStatusActive = isActiveStatus(previousTask?.status);
  if (previousFingerprint === fingerprint && previousStatusActive) {
    return {
      task_id: normalizeOptionalText(previousTask?.task_id) || GIT_REMEDIATION_TASK_ID,
      issue_count: normalizedIssues.length,
      persisted: false,
      dispatched: false,
      skipped: true,
      warnings: ["Git remediation is already active for the current issue fingerprint"],
    };
  }

  const warnings: string[] = [];
  if (typeof options.host.upsertTaskNerveProjectTasks !== "function") {
    return {
      task_id: GIT_REMEDIATION_TASK_ID,
      issue_count: normalizedIssues.length,
      persisted: false,
      dispatched: false,
      skipped: true,
      warnings: [
        "Codex host method upsertTaskNerveProjectTasks is unavailable; cannot auto-escalate git remediation to controller",
      ],
    };
  }

  const generatedAtUtc = normalizeOptionalText(options.nowIsoUtc) || nowIsoUtc();
  const remediationTask = buildRemediationTask({
    repoRoot: options.repoRoot,
    settings: options.settings,
    issues: normalizedIssues,
    fingerprint,
    generatedAtUtc,
    previousTask,
    taskNerve: options.taskNerve,
  });

  await options.host.upsertTaskNerveProjectTasks({
    repoRoot: options.repoRoot,
    tasks: [remediationTask],
  });

  const dispatchResult = await dispatchTaskNerveTasksWithPolicy({
    host: options.host,
    taskNerve: options.taskNerve,
    repoRoot: options.repoRoot,
    settings: options.settings,
    taskIds: [remediationTask.task_id],
    projectTasks: options.tasks || [],
    candidateTasks: [remediationTask],
    label: "git remediation",
  });
  warnings.push(...dispatchResult.warnings);

  return {
    task_id: remediationTask.task_id,
    issue_count: normalizedIssues.length,
    persisted: true,
    dispatched: dispatchResult.dispatched_task_ids.length > 0,
    skipped: false,
    warnings,
  };
}
