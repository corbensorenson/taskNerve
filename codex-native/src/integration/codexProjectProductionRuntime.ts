import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type { CodexHostServices } from "../host/codexHostServices.js";
import {
  buildProjectSelfImprovementPlan,
  projectSettingsAfterSelfImprovementDispatch,
} from "../domain/projectSelfImprovement.js";
import { planCodexProjectGitSync } from "./codexProjectGitSync.js";
import {
  runCodexAgentWatchdog,
  type CodexAgentWatchdogRunResult,
} from "./codexAgentWatchdog.js";
import {
  escalateGitIssuesToController,
  type GitIssueSignal,
} from "./codexGitIssueRemediation.js";
import {
  buildCodexProjectProductionSnapshot,
  type CodexProjectProductionSnapshot,
} from "./codexProjectProduction.js";
import type { TaskNerveService } from "./taskNerveService.js";

export interface CodexProjectProductionSnapshotOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  gitOriginUrl?: string | null;
  gitState?: unknown;
  ciFailures?: unknown;
  availableAgentIds?: string[];
  nowIsoUtc?: string | null;
}

export interface CodexProjectProductionRunOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  gitOriginUrl?: string | null;
  gitState?: unknown;
  ciFailures?: unknown;
  availableAgentIds?: string[];
  mode?: "smart" | "pull" | "push";
  autostash?: boolean;
  forcePush?: boolean;
  autoSwitchPreferredBranch?: boolean;
  persistCiTasks?: boolean;
  dispatchCiTasks?: boolean;
  nowIsoUtc?: string | null;
}

export interface CodexProjectProductionRunResult {
  integration_mode: "codex-native-host";
  before: CodexProjectProductionSnapshot;
  after: CodexProjectProductionSnapshot;
  executed: {
    switched_branch: boolean;
    pull: boolean;
    push: boolean;
    ci_task_upserts: number;
    ci_dispatch_count: number;
    self_improvement_task_upserts: number;
    self_improvement_dispatch_count: number;
    watchdog_worker_resets: number;
    watchdog_controller_resets: number;
  };
  timings_ms: {
    load_context: number;
    ci_sync: number;
    git_sync: number;
    watchdog_sync: number;
    self_improvement_sync: number;
    persist_settings: number;
    total: number;
  };
  watchdog: CodexAgentWatchdogRunResult;
  warnings: string[];
}

interface LoadedCodexProjectProductionContext {
  settings: ProjectCodexSettings;
  gitState: unknown;
  ciFailures: unknown;
  availableAgentIds: string[];
  gitSnapshot: ProjectGitSyncSnapshot;
  ciSnapshot: ProjectCiTaskSyncPlan;
  snapshot: CodexProjectProductionSnapshot;
}

interface CodexProjectProductionLoadDependencies {
  taskNerve: TaskNerveService;
  loadProjectGitState: (repoRoot: string, override?: unknown) => Promise<unknown>;
  loadProjectCiFailures: (repoRoot: string, override?: unknown) => Promise<unknown>;
  loadProjectCiAgentIds: (overrides?: unknown) => Promise<string[]>;
}

export async function loadCodexProjectProductionContext(
  dependencies: CodexProjectProductionLoadDependencies,
  options: CodexProjectProductionSnapshotOptions,
): Promise<LoadedCodexProjectProductionContext> {
  const [settings, gitState, ciFailures, availableAgentIds] = await Promise.all([
    dependencies.taskNerve.loadProjectSettings({
      repoRoot: options.repoRoot,
      gitOriginUrl: options.gitOriginUrl,
    }),
    dependencies.loadProjectGitState(options.repoRoot, options.gitState),
    dependencies.loadProjectCiFailures(options.repoRoot, options.ciFailures),
    dependencies.loadProjectCiAgentIds(options.availableAgentIds),
  ]);

  const gitSnapshot = dependencies.taskNerve.projectGitSyncSnapshot({
    settings,
    tasks: options.tasks,
    git_state: gitState,
    now_iso: options.nowIsoUtc ?? undefined,
  });
  const ciSnapshot = dependencies.taskNerve.projectCiTaskSyncPlan({
    settings,
    tasks: options.tasks,
    failures: ciFailures,
    available_agent_ids: availableAgentIds,
    now_iso: options.nowIsoUtc ?? undefined,
  });

  return {
    settings,
    gitState,
    ciFailures,
    availableAgentIds,
    gitSnapshot,
    ciSnapshot,
    snapshot: buildCodexProjectProductionSnapshot({
      git: gitSnapshot,
      ci: ciSnapshot,
      generated_at_utc: options.nowIsoUtc ?? undefined,
    }),
  };
}

interface CodexProjectProductionSyncDependencies extends CodexProjectProductionLoadDependencies {
  host: CodexHostServices;
  invalidateProjectGitStateCache: (repoRoot?: string | null) => void;
  invalidateProjectCiFailureCache: (repoRoot?: string | null) => void;
}

export async function syncCodexProjectProduction(
  dependencies: CodexProjectProductionSyncDependencies,
  options: CodexProjectProductionRunOptions,
): Promise<CodexProjectProductionRunResult> {
  const startedAtMs = Date.now();
  const contextStartMs = Date.now();
  const context = await loadCodexProjectProductionContext(dependencies, options);
  const timings = {
    load_context: Date.now() - contextStartMs,
    ci_sync: 0,
    git_sync: 0,
    watchdog_sync: 0,
    self_improvement_sync: 0,
    persist_settings: 0,
    total: 0,
  };
  const warnings: string[] = [];
  let persistedTaskUpserts = 0;
  let dispatchedTaskIds: string[] = [];
  let selfImprovementTaskUpserts = 0;
  let selfImprovementDispatchTaskIds: string[] = [];
  let pulled = false;
  let pushed = false;
  let switchedBranch = false;
  const gitIssues: GitIssueSignal[] = [];
  let effectiveSettings = dependencies.taskNerve.projectSettingsAfterCiSync({
    settings: context.settings,
    failed_job_count: context.ciSnapshot.ci_metrics.unique_failure_count,
    synced_at_utc: options.nowIsoUtc ?? undefined,
  });
  let effectiveGitState = context.gitState;

  const ciStartMs = Date.now();
  const ciTaskPayload = context.ciSnapshot.task_upserts.map((entry) => entry.task);
  if (!context.ciSnapshot.policy.auto_task_enabled) {
    warnings.push("CI auto-tasking is disabled in project settings");
  } else if (options.persistCiTasks === false) {
    warnings.push("CI task persistence skipped by request");
  } else if (ciTaskPayload.length > 0) {
    if (typeof dependencies.host.upsertTaskNerveProjectTasks !== "function") {
      warnings.push("Codex host method upsertTaskNerveProjectTasks is unavailable");
    } else {
      await dependencies.host.upsertTaskNerveProjectTasks({
        repoRoot: options.repoRoot,
        tasks: ciTaskPayload,
      });
      persistedTaskUpserts = ciTaskPayload.length;
    }
  }

  const shouldDispatch = options.dispatchCiTasks !== false;
  if (!shouldDispatch) {
    // Explicit opt-out: keep snapshot output but skip host dispatch call.
  } else if (!context.ciSnapshot.policy.auto_task_enabled) {
    // Auto-tasking disabled; dispatch is intentionally suppressed.
  } else if (persistedTaskUpserts <= 0 || context.ciSnapshot.dispatch_task_ids.length === 0) {
    // Nothing new to dispatch.
  } else if (typeof dependencies.host.dispatchTaskNerveTasks !== "function") {
    warnings.push("Codex host method dispatchTaskNerveTasks is unavailable");
  } else {
    const qualityGate = dependencies.taskNerve.gateDispatchTaskIdsByQuality({
      settings: effectiveSettings,
      task_ids: context.ciSnapshot.dispatch_task_ids,
      tasks: context.ciSnapshot.task_upserts.map((entry) => entry.task),
    });
    if (qualityGate.blocked_task_ids.length > 0) {
      warnings.push(
        `Task quality gate blocked ${qualityGate.blocked_task_ids.length} dispatch item(s): ${qualityGate.blocked_task_ids.join(
          ", ",
        )}`,
      );
    }
    dispatchedTaskIds = [...qualityGate.allowed_task_ids];
    if (dispatchedTaskIds.length > 0) {
      await dependencies.host.dispatchTaskNerveTasks({
        repoRoot: options.repoRoot,
        task_ids: dispatchedTaskIds,
      });
    }
  }
  timings.ci_sync = Date.now() - ciStartMs;
  dependencies.invalidateProjectCiFailureCache(options.repoRoot);

  const gitStartMs = Date.now();
  let gitSnapshotBeforeSync = dependencies.taskNerve.projectGitSyncSnapshot({
    settings: effectiveSettings,
    tasks: options.tasks,
    git_state: effectiveGitState,
    now_iso: options.nowIsoUtc ?? undefined,
  });
  const preferredBranch = gitSnapshotBeforeSync.push_policy.preferred_branch;
  if (
    options.autoSwitchPreferredBranch !== false &&
    typeof preferredBranch === "string" &&
    preferredBranch.trim() &&
    gitSnapshotBeforeSync.branch_status.current_branch !== preferredBranch &&
    typeof dependencies.host.switchTaskNerveBranch === "function"
  ) {
    try {
      await dependencies.host.switchTaskNerveBranch(preferredBranch);
      switchedBranch = true;
      dependencies.invalidateProjectGitStateCache(options.repoRoot);
      effectiveGitState = await dependencies.loadProjectGitState(options.repoRoot);
      gitSnapshotBeforeSync = dependencies.taskNerve.projectGitSyncSnapshot({
        settings: effectiveSettings,
        tasks: options.tasks,
        git_state: effectiveGitState,
        now_iso: options.nowIsoUtc ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Branch switch failed: ${message}`);
      gitIssues.push({
        key: `branch-switch-failed:${preferredBranch}`,
        phase: "branch-switch",
        summary: `Preferred branch switch to ${preferredBranch} failed`,
        detail: message,
      });
    }
  } else if (
    options.autoSwitchPreferredBranch !== false &&
    typeof preferredBranch === "string" &&
    preferredBranch.trim() &&
    gitSnapshotBeforeSync.branch_status.current_branch !== preferredBranch &&
    typeof dependencies.host.switchTaskNerveBranch !== "function"
  ) {
    warnings.push("Codex host method switchTaskNerveBranch is unavailable");
    gitIssues.push({
      key: `branch-switch-method-unavailable:${preferredBranch}`,
      phase: "branch-switch",
      summary: "Codex host method switchTaskNerveBranch is unavailable",
      detail: `Preferred branch ${preferredBranch} could not be activated automatically`,
    });
  }

  const plan = planCodexProjectGitSync({
    mode: options.mode,
    snapshot: gitSnapshotBeforeSync,
  });

  if (plan.should_pull) {
    if (typeof dependencies.host.pullRepository !== "function") {
      warnings.push("Codex host method pullRepository is unavailable");
      gitIssues.push({
        key: "pull-method-unavailable",
        phase: "pull",
        summary: "Codex host method pullRepository is unavailable",
      });
    } else {
      try {
        await dependencies.host.pullRepository({
          repoRoot: options.repoRoot,
          autostash: options.autostash ?? true,
        });
        pulled = true;
        dependencies.invalidateProjectGitStateCache(options.repoRoot);
        effectiveGitState = await dependencies.loadProjectGitState(options.repoRoot);
        gitSnapshotBeforeSync = dependencies.taskNerve.projectGitSyncSnapshot({
          settings: effectiveSettings,
          tasks: options.tasks,
          git_state: effectiveGitState,
          now_iso: options.nowIsoUtc ?? undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Pull failed: ${message}`);
        gitIssues.push({
          key: "pull-failed",
          phase: "pull",
          summary: "TaskNerve pull operation failed",
          detail: message,
        });
      }
    }
  }

  const pushBlockedReason = gitSnapshotBeforeSync.recommendation.push_blocked_reason;
  const ignoreInsufficientVolumeBlock =
    plan.mode !== "smart" && pushBlockedReason === "insufficient-task-volume";
  const hardBlockedByPolicy =
    plan.should_push &&
    pushBlockedReason !== null &&
    !ignoreInsufficientVolumeBlock &&
    options.forcePush !== true;

  if (hardBlockedByPolicy) {
    warnings.push(`Push skipped: ${pushBlockedReason}`);
    if (pushBlockedReason) {
      gitIssues.push({
        key: `push-blocked:${pushBlockedReason}`,
        phase: "policy",
        summary: `Push blocked by policy: ${pushBlockedReason}`,
      });
    }
  } else if (
    plan.reason === "smart-push-blocked" &&
    pushBlockedReason !== null &&
    pushBlockedReason !== "insufficient-task-volume"
  ) {
    warnings.push(`Git sync blocked: ${pushBlockedReason}`);
    gitIssues.push({
      key: `smart-push-blocked:${pushBlockedReason}`,
      phase: "policy",
      summary: `Smart git sync is blocked: ${pushBlockedReason}`,
    });
  } else if (plan.should_push) {
    if (typeof dependencies.host.pushRepository !== "function") {
      warnings.push("Codex host method pushRepository is unavailable");
      gitIssues.push({
        key: "push-method-unavailable",
        phase: "push",
        summary: "Codex host method pushRepository is unavailable",
      });
    } else {
      try {
        await dependencies.host.pushRepository({
          repoRoot: options.repoRoot,
        });
        pushed = true;
        effectiveSettings = dependencies.taskNerve.projectSettingsAfterGitPush({
          settings: effectiveSettings,
          tasks: options.tasks,
          pushed_at_utc: options.nowIsoUtc ?? undefined,
        });
        dependencies.invalidateProjectGitStateCache(options.repoRoot);
        effectiveGitState = await dependencies.loadProjectGitState(options.repoRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Push failed: ${message}`);
        gitIssues.push({
          key: "push-failed",
          phase: "push",
          summary: "TaskNerve push operation failed",
          detail: message,
        });
      }
    }
  }
  timings.git_sync = Date.now() - gitStartMs;

  const persistStartMs = Date.now();
  let settingsAfterSync = await dependencies.taskNerve.writeProjectSettings(
    options.repoRoot,
    effectiveSettings,
  );
  timings.persist_settings = Date.now() - persistStartMs;
  const remediationResult = await escalateGitIssuesToController({
    host: dependencies.host,
    taskNerve: dependencies.taskNerve,
    repoRoot: options.repoRoot,
    nowIsoUtc: options.nowIsoUtc,
    settings: settingsAfterSync,
    tasks: options.tasks,
    issues: gitIssues,
  });
  warnings.push(...remediationResult.warnings);
  const watchdogStartMs = Date.now();
  const watchdog = await runCodexAgentWatchdog(
    {
      host: dependencies.host,
      taskNerve: dependencies.taskNerve,
    },
    {
      repoRoot: options.repoRoot,
      projectName: null,
      tasks: options.tasks,
      settings: settingsAfterSync,
      nowIsoUtc: options.nowIsoUtc,
    },
  );
  timings.watchdog_sync = Date.now() - watchdogStartMs;
  warnings.push(...watchdog.warnings);

  const selfImprovementStartMs = Date.now();
  const selfImprovementPlan = buildProjectSelfImprovementPlan({
    settings: settingsAfterSync,
    tasks: options.tasks,
    warnings,
    git_issues: gitIssues.map((issue) => ({
      ...issue,
      detail: issue.detail ?? undefined,
    })),
    watchdog: {
      worker_resets: watchdog.worker_resets,
      controller_resets: watchdog.controller_resets,
      stalled_worker_candidates: watchdog.stalled_worker_candidates,
      stalled_controller_candidates: watchdog.stalled_controller_candidates,
    },
    now_iso: options.nowIsoUtc ?? undefined,
  });

  if (selfImprovementPlan.blocked_by_cooldown) {
    warnings.push(
      "Self-improvement dispatch cooldown is active; auto-generated maintenance tasks were queued without dispatch.",
    );
  }
  if (selfImprovementPlan.task_upserts.length > 0) {
    if (typeof dependencies.host.upsertTaskNerveProjectTasks !== "function") {
      warnings.push("Codex host method upsertTaskNerveProjectTasks is unavailable");
    } else {
      await dependencies.host.upsertTaskNerveProjectTasks({
        repoRoot: options.repoRoot,
        tasks: selfImprovementPlan.task_upserts.map((entry) => entry.task),
      });
      selfImprovementTaskUpserts = selfImprovementPlan.task_upserts.length;
    }
  }

  if (selfImprovementPlan.dispatch_task_ids.length > 0) {
    if (typeof dependencies.host.dispatchTaskNerveTasks !== "function") {
      warnings.push("Codex host method dispatchTaskNerveTasks is unavailable");
    } else {
      const qualityGate = dependencies.taskNerve.gateDispatchTaskIdsByQuality({
        settings: settingsAfterSync,
        task_ids: selfImprovementPlan.dispatch_task_ids,
        tasks: selfImprovementPlan.task_upserts.map((entry) => entry.task),
      });
      if (qualityGate.blocked_task_ids.length > 0) {
        warnings.push(
          `Task quality gate blocked ${qualityGate.blocked_task_ids.length} self-improvement dispatch item(s): ${qualityGate.blocked_task_ids.join(
            ", ",
          )}`,
        );
      }
      selfImprovementDispatchTaskIds = [...qualityGate.allowed_task_ids];
      if (selfImprovementDispatchTaskIds.length > 0) {
        await dependencies.host.dispatchTaskNerveTasks({
          repoRoot: options.repoRoot,
          task_ids: selfImprovementDispatchTaskIds,
        });
      }
    }
  }

  if (selfImprovementDispatchTaskIds.length > 0) {
    const persistSelfImproveStartMs = Date.now();
    settingsAfterSync = await dependencies.taskNerve.writeProjectSettings(
      options.repoRoot,
      projectSettingsAfterSelfImprovementDispatch({
        settings: settingsAfterSync,
        dispatched_task_count: selfImprovementDispatchTaskIds.length,
        dispatched_at_utc: options.nowIsoUtc ?? undefined,
      }),
    );
    timings.persist_settings += Date.now() - persistSelfImproveStartMs;
  }
  timings.self_improvement_sync = Date.now() - selfImprovementStartMs;

  const afterGit = dependencies.taskNerve.projectGitSyncSnapshot({
    settings: settingsAfterSync,
    tasks: options.tasks,
    git_state: effectiveGitState,
    now_iso: options.nowIsoUtc ?? undefined,
  });
  const afterCi = dependencies.taskNerve.projectCiTaskSyncPlan({
    settings: settingsAfterSync,
    tasks: options.tasks,
    failures: context.ciFailures,
    available_agent_ids: context.availableAgentIds,
    now_iso: options.nowIsoUtc ?? undefined,
  });
  const after = buildCodexProjectProductionSnapshot({
    git: afterGit,
    ci: afterCi,
    generated_at_utc: options.nowIsoUtc ?? undefined,
  });

  timings.total = Date.now() - startedAtMs;

  return {
    integration_mode: "codex-native-host",
    before: context.snapshot,
    after,
    watchdog,
    executed: {
      switched_branch: switchedBranch,
      pull: pulled,
      push: pushed,
      ci_task_upserts: persistedTaskUpserts,
      ci_dispatch_count: dispatchedTaskIds.length,
      self_improvement_task_upserts: selfImprovementTaskUpserts,
      self_improvement_dispatch_count: selfImprovementDispatchTaskIds.length,
      watchdog_worker_resets: watchdog.worker_resets,
      watchdog_controller_resets: watchdog.controller_resets,
    },
    timings_ms: timings,
    warnings,
  };
}
