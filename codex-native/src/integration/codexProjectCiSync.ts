import {
  buildProjectCiTaskSyncPlan,
  buildProjectSettingsAfterCiSync,
  type BuildProjectCiTaskSyncPlanOptions,
  type BuildProjectSettingsAfterCiSyncOptions,
  type ProjectCiFailure,
  type ProjectCiFailureStatus,
  type ProjectCiTaskSyncPlan,
} from "../domain/projectCiSync.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeFailureStatus(value: unknown): ProjectCiFailureStatus | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "failed":
    case "failure":
      return "failed";
    case "error":
    case "errored":
      return "error";
    case "timed_out":
    case "timed out":
    case "timeout":
      return "timed_out";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

function parseBranch(value: unknown): string | null {
  const branch = normalizeOptionalText(value);
  if (!branch) {
    return null;
  }
  if (!branch.startsWith("refs/heads/")) {
    return branch;
  }
  return branch.slice("refs/heads/".length) || null;
}

export function parseCodexProjectCiFailure(value: unknown): Partial<ProjectCiFailure> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status =
    normalizeFailureStatus(record.status) ??
    normalizeFailureStatus(record.conclusion) ??
    normalizeFailureStatus(record.state) ??
    normalizeFailureStatus(record.outcome) ??
    normalizeFailureStatus(record.result);
  const failedFlag =
    typeof record.failed === "boolean"
      ? record.failed
      : typeof record.is_failed === "boolean"
        ? record.is_failed
        : null;

  const effectiveStatus = status ?? (failedFlag ? "failed" : null);
  if (!effectiveStatus) {
    return null;
  }

  const job =
    normalizeOptionalText(record.job) ??
    normalizeOptionalText(record.job_name) ??
    normalizeOptionalText(record.name) ??
    normalizeOptionalText(record.context) ??
    normalizeOptionalText(record.check_name) ??
    normalizeOptionalText(record.title);
  const pipeline =
    normalizeOptionalText(record.pipeline) ??
    normalizeOptionalText(record.workflow) ??
    normalizeOptionalText(record.workflow_name) ??
    normalizeOptionalText(record.check_suite) ??
    normalizeOptionalText(record.stage);

  if (!job && !pipeline) {
    return null;
  }

  return {
    provider:
      normalizeOptionalText(record.provider) ??
      normalizeOptionalText(record.source) ??
      normalizeOptionalText(record.service),
    pipeline,
    job: job || pipeline || "ci-failure",
    branch:
      parseBranch(record.branch) ??
      parseBranch(record.head_branch) ??
      parseBranch(record.ref) ??
      parseBranch(record.target_branch),
    commit_sha:
      normalizeOptionalText(record.commit_sha) ??
      normalizeOptionalText(record.head_sha) ??
      normalizeOptionalText(record.sha) ??
      normalizeOptionalText(record.commit),
    run_id:
      normalizeOptionalText(record.run_id) ??
      normalizeOptionalText(record.runId) ??
      normalizeOptionalText(record.build_id) ??
      normalizeOptionalText(record.id),
    run_url:
      normalizeOptionalText(record.run_url) ??
      normalizeOptionalText(record.url) ??
      normalizeOptionalText(record.html_url) ??
      normalizeOptionalText(record.web_url) ??
      normalizeOptionalText(record.details_url),
    status: effectiveStatus,
    summary:
      normalizeOptionalText(record.summary) ??
      normalizeOptionalText(record.failure_reason) ??
      normalizeOptionalText(record.error) ??
      normalizeOptionalText(record.message),
    detected_at_utc:
      normalizeOptionalText(record.failed_at) ??
      normalizeOptionalText(record.completed_at) ??
      normalizeOptionalText(record.updated_at) ??
      normalizeOptionalText(record.created_at) ??
      normalizeOptionalText(record.timestamp),
  };
}

function normalizeCiFailureArray(value: unknown): Partial<ProjectCiFailure>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const failures: Partial<ProjectCiFailure>[] = [];
  for (const entry of value) {
    const normalized = parseCodexProjectCiFailure(entry);
    if (normalized) {
      failures.push(normalized);
    }
  }
  return failures;
}

export function parseCodexProjectCiFailures(value: unknown): Partial<ProjectCiFailure>[] {
  if (Array.isArray(value)) {
    return normalizeCiFailureArray(value);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const candidateCollections = [
    record.failures,
    record.jobs,
    record.checks,
    record.workflows,
    record.runs,
    record.items,
  ];
  for (const candidate of candidateCollections) {
    const parsed = normalizeCiFailureArray(candidate);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const single = parseCodexProjectCiFailure(record);
  return single ? [single] : [];
}

export function buildCodexProjectCiTaskSyncPlan(
  options: Omit<BuildProjectCiTaskSyncPlanOptions, "failures"> & { failures?: unknown },
): ProjectCiTaskSyncPlan {
  return buildProjectCiTaskSyncPlan({
    ...options,
    failures: parseCodexProjectCiFailures(options.failures),
  });
}

export function buildProjectSettingsAfterCodexCiSync(options: BuildProjectSettingsAfterCiSyncOptions) {
  return buildProjectSettingsAfterCiSync(options);
}
