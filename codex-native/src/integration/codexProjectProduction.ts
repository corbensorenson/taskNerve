import { nowIsoUtc } from "../constants.js";
import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";

export type CodexProjectProductionBottleneckId =
  | "git-auto-sync-disabled"
  | "git-branch-mismatch"
  | "git-push-blocked"
  | "ci-failures-detected"
  | "ci-auto-task-disabled"
  | "ci-task-dispatch-pending";

export interface CodexProjectProductionBottleneck {
  id: CodexProjectProductionBottleneckId;
  severity: "info" | "warning" | "critical";
  summary: string;
}

export interface CodexProjectProductionSnapshot {
  integration_mode: "codex-native-host";
  generated_at_utc: string;
  git: ProjectGitSyncSnapshot;
  ci: ProjectCiTaskSyncPlan;
  bottlenecks: CodexProjectProductionBottleneck[];
}

export interface BuildCodexProjectProductionSnapshotOptions {
  git: ProjectGitSyncSnapshot;
  ci: ProjectCiTaskSyncPlan;
  generated_at_utc?: string | null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function buildCodexProjectProductionSnapshot(
  options: BuildCodexProjectProductionSnapshotOptions,
): CodexProjectProductionSnapshot {
  const bottlenecks: CodexProjectProductionBottleneck[] = [];

  if (!options.git.push_policy.auto_sync_enabled) {
    bottlenecks.push({
      id: "git-auto-sync-disabled",
      severity: "info",
      summary: "Git auto-sync is disabled for this project",
    });
  }

  if (options.git.branch_status.on_preferred_branch === false) {
    const currentBranch = normalizeOptionalText(options.git.branch_status.current_branch) || "unknown";
    const preferred = normalizeOptionalText(options.git.push_policy.preferred_branch) || "preferred branch";
    bottlenecks.push({
      id: "git-branch-mismatch",
      severity: "warning",
      summary: `Current branch ${currentBranch} differs from preferred ${preferred}`,
    });
  }

  if (options.git.recommendation.reason === "push-blocked") {
    const reason = normalizeOptionalText(options.git.recommendation.push_blocked_reason) || "unknown";
    bottlenecks.push({
      id: "git-push-blocked",
      severity: "warning",
      summary: `Git push is currently blocked: ${reason}`,
    });
  }

  if (options.ci.ci_metrics.unique_failure_count > 0) {
    bottlenecks.push({
      id: "ci-failures-detected",
      severity: options.ci.policy.auto_task_enabled ? "warning" : "critical",
      summary: `${options.ci.ci_metrics.unique_failure_count} CI failure(s) detected`,
    });
  }

  if (!options.ci.policy.auto_task_enabled && options.ci.ci_metrics.unique_failure_count > 0) {
    bottlenecks.push({
      id: "ci-auto-task-disabled",
      severity: "critical",
      summary: "CI auto-tasking is disabled while failures are present",
    });
  }

  if (
    options.ci.policy.auto_task_enabled &&
    options.ci.ci_metrics.task_upsert_count > 0 &&
    options.ci.ci_metrics.dispatch_count === 0
  ) {
    bottlenecks.push({
      id: "ci-task-dispatch-pending",
      severity: "warning",
      summary: "CI-generated tasks are pending dispatch",
    });
  }

  return {
    integration_mode: "codex-native-host",
    generated_at_utc: normalizeOptionalText(options.generated_at_utc) || nowIsoUtc(),
    git: options.git,
    ci: options.ci,
    bottlenecks,
  };
}
