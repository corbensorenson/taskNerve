import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type { CodexHostServices } from "../host/codexHostServices.js";
import { planCodexProjectGitSync } from "./codexProjectGitSync.js";
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
  };
  timings_ms: {
    load_context: number;
    ci_sync: number;
    git_sync: number;
    persist_settings: number;
    total: number;
  };
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
    persist_settings: 0,
    total: 0,
  };
  const warnings: string[] = [];
  let persistedTaskUpserts = 0;
  let dispatchedTaskIds: string[] = [];
  let pulled = false;
  let pushed = false;
  let switchedBranch = false;
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
    dispatchedTaskIds = [...context.ciSnapshot.dispatch_task_ids];
    await dependencies.host.dispatchTaskNerveTasks({
      repoRoot: options.repoRoot,
      task_ids: dispatchedTaskIds,
    });
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
  } else if (
    options.autoSwitchPreferredBranch !== false &&
    typeof preferredBranch === "string" &&
    preferredBranch.trim() &&
    gitSnapshotBeforeSync.branch_status.current_branch !== preferredBranch &&
    typeof dependencies.host.switchTaskNerveBranch !== "function"
  ) {
    warnings.push("Codex host method switchTaskNerveBranch is unavailable");
  }

  const plan = planCodexProjectGitSync({
    mode: options.mode,
    snapshot: gitSnapshotBeforeSync,
  });

  if (plan.should_pull) {
    if (typeof dependencies.host.pullRepository !== "function") {
      warnings.push("Codex host method pullRepository is unavailable");
    } else {
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
  } else if (plan.should_push) {
    if (typeof dependencies.host.pushRepository !== "function") {
      warnings.push("Codex host method pushRepository is unavailable");
    } else {
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
    }
  }
  timings.git_sync = Date.now() - gitStartMs;

  const persistStartMs = Date.now();
  const settingsAfterSync = await dependencies.taskNerve.writeProjectSettings(
    options.repoRoot,
    effectiveSettings,
  );
  timings.persist_settings = Date.now() - persistStartMs;

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
    executed: {
      switched_branch: switchedBranch,
      pull: pulled,
      push: pushed,
      ci_task_upserts: persistedTaskUpserts,
      ci_dispatch_count: dispatchedTaskIds.length,
    },
    timings_ms: timings,
    warnings,
  };
}
