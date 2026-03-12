import { nowIsoUtc } from "../constants.js";
import {
  buildControllerBootstrapPrompt,
  type ControllerBootstrapOptions,
} from "../domain/controllerBootstrap.js";
import {
  renderProjectGoalsTemplate,
  renderProjectManifestTemplate,
  type ProjectContractSummary,
} from "../domain/projectContracts.js";
import {
  buildProjectTaskStats,
  gateTaskDispatchByQuality,
  mergePromptQueue,
  sortTasks,
  taskUserTags,
} from "../domain/taskQueue.js";
import {
  normalizeProjectCodexSettings,
  resolveControllerModelFromNormalizedSettings,
  resolveWorkerModelForTaskWithNormalizedSettings,
} from "../domain/projectCodexSettings.js";
import type {
  ProjectCodexSettings,
  ProjectRegistry,
  PromptQueueRequest,
  TaskRecord,
} from "../schemas.js";
import { loadProjectCodexSettings, writeProjectCodexSettings } from "../io/projectCodexSettingsStore.js";
import { loadProjectRegistry, writeProjectRegistry } from "../io/projectRegistryStore.js";
import {
  buildThreadDisplaySnapshot,
  type BuildThreadDisplayOptions,
  type ThreadDisplaySnapshot,
} from "./threadDisplay/index.js";
import {
  buildCodexConversationDisplaySnapshot,
  type CodexConversationDisplayOptions,
  type CodexConversationDisplaySnapshot,
} from "./codexConversationDisplay.js";
import {
  conversationInteractionStep,
  type CodexConversationInteractionInput,
  type CodexConversationInteractionResult,
} from "./codexConversationInteraction.js";
import {
  buildCodexProjectGitSyncSnapshot,
  buildProjectSettingsAfterCodexGitPush,
} from "./codexProjectGitSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";
import {
  buildCodexProjectCiTaskSyncPlan,
  buildProjectSettingsAfterCodexCiSync,
} from "./codexProjectCiSync.js";
import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import {
  buildCodexProjectProductionSnapshot,
  type CodexProjectProductionSnapshot,
} from "./codexProjectProduction.js";

export interface TaskNerveServiceHealth {
  ok: true;
  mode: "codex-native-integration";
  generated_at_utc: string;
  capabilities: string[];
}

export interface TaskNerveTaskSnapshot {
  search: string;
  all_tasks: Partial<TaskRecord>[];
  visible_tasks: Partial<TaskRecord>[];
  all_stats: ReturnType<typeof buildProjectTaskStats>;
  visible_stats: ReturnType<typeof buildProjectTaskStats>;
  user_tags: string[];
}

export interface TaskNerveService {
  health: () => TaskNerveServiceHealth;
  buildControllerPrompt: (options: ControllerBootstrapOptions) => string;
  renderProjectContracts: (summary: ProjectContractSummary) => {
    project_goals: string;
    project_manifest: string;
  };
  taskSnapshot: (tasks: Partial<TaskRecord>[], search?: string) => TaskNerveTaskSnapshot;
  queuePrompt: (
    queue: Partial<PromptQueueRequest>[],
    request: Partial<PromptQueueRequest>,
    options?: { singleMessageMode?: boolean },
  ) => ReturnType<typeof mergePromptQueue>;
  gateDispatchTaskIdsByQuality: (options: {
    settings: Partial<ProjectCodexSettings>;
    task_ids: string[];
    tasks: Partial<TaskRecord>[];
  }) => ReturnType<typeof gateTaskDispatchByQuality>;
  resolveModelsForTask: (
    settings: Partial<ProjectCodexSettings>,
    task?: Partial<TaskRecord>,
  ) => {
    controller_model: string | null;
    worker_model: string | null;
  };
  normalizeProjectSettings: (settings: Partial<ProjectCodexSettings>) => ProjectCodexSettings;
  loadProjectSettings: (options: {
    repoRoot: string;
    gitOriginUrl?: string | null;
  }) => Promise<ProjectCodexSettings>;
  writeProjectSettings: (
    repoRoot: string,
    settings: Partial<ProjectCodexSettings>,
  ) => Promise<ProjectCodexSettings>;
  loadRegistry: (env?: NodeJS.ProcessEnv) => Promise<ProjectRegistry>;
  writeRegistry: (registry: ProjectRegistry, env?: NodeJS.ProcessEnv) => Promise<ProjectRegistry>;
  conversationDisplaySnapshot: (
    options: CodexConversationDisplayOptions,
  ) => CodexConversationDisplaySnapshot;
  conversationInteractionStep: (
    input: CodexConversationInteractionInput,
  ) => CodexConversationInteractionResult;
  projectGitSyncSnapshot: (options: {
    settings: Partial<ProjectCodexSettings>;
    tasks?: Partial<TaskRecord>[];
    git_state?: unknown;
    now_iso?: string;
  }) => ProjectGitSyncSnapshot;
  projectSettingsAfterGitPush: (options: {
    settings: Partial<ProjectCodexSettings>;
    tasks?: Partial<TaskRecord>[];
    pushed_at_utc?: string;
    tasks_pushed_count?: number;
  }) => ProjectCodexSettings;
  projectCiTaskSyncPlan: (options: {
    settings: Partial<ProjectCodexSettings>;
    tasks?: Partial<TaskRecord>[];
    failures?: unknown;
    available_agent_ids?: string[];
    now_iso?: string;
  }) => ProjectCiTaskSyncPlan;
  projectProductionSnapshot: (options: {
    git: ProjectGitSyncSnapshot;
    ci: ProjectCiTaskSyncPlan;
    generated_at_utc?: string | null;
  }) => CodexProjectProductionSnapshot;
  projectSettingsAfterCiSync: (options: {
    settings: Partial<ProjectCodexSettings>;
    failed_job_count: number;
    synced_at_utc?: string;
  }) => ProjectCodexSettings;
  threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => ThreadDisplaySnapshot;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

const TASK_SNAPSHOT_SEARCH_CACHE_LIMIT = 12;
const TASK_SNAPSHOT_RAW_SEARCH_VARIANTS_LIMIT = 4;

interface TaskSnapshotBaseMemo {
  tasksRef: Partial<TaskRecord>[];
  tasksQuickMarker: string;
  allTasks: Partial<TaskRecord>[];
  searchableTextByTask: string[];
  allStats: ReturnType<typeof buildProjectTaskStats>;
  userTags: string[];
  searchCache: Map<
    string,
    {
      visibleTasks: Partial<TaskRecord>[];
      visibleStats: ReturnType<typeof buildProjectTaskStats>;
      snapshotsBySearch: Map<string, TaskNerveTaskSnapshot>;
    }
  >;
}

function normalizeSearchText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function joinNormalizedStringArray(values: unknown): string {
  if (!Array.isArray(values)) {
    return "";
  }
  return values
    .map((entry) => normalizeSearchText(entry))
    .filter(Boolean)
    .join(" ");
}

function taskSearchText(task: Partial<TaskRecord>): string {
  return [
    normalizeSearchText(task.task_id),
    normalizeSearchText(task.title),
    normalizeSearchText(task.detail),
    normalizeSearchText(task.objective),
    normalizeSearchText(task.task_type),
    normalizeSearchText(task.subsystem),
    normalizeSearchText(task.implementation_notes),
    normalizeSearchText(task.estimated_effort),
    normalizeSearchText(task.claimed_by_agent_id),
    joinNormalizedStringArray(task.tags),
    joinNormalizedStringArray(task.depends_on),
    joinNormalizedStringArray(task.files_in_scope),
    joinNormalizedStringArray(task.out_of_scope),
    joinNormalizedStringArray(task.acceptance_criteria),
    joinNormalizedStringArray(task.deliverables),
    joinNormalizedStringArray(task.verification_steps),
    joinNormalizedStringArray(task.risk_notes),
  ]
    .filter(Boolean)
    .join(" ");
}

function filterSortedTasksBySearch(
  tasks: Partial<TaskRecord>[],
  searchableTextByTask: string[],
  normalizedSearch: string,
): Partial<TaskRecord>[] {
  if (!normalizedSearch) {
    return tasks;
  }

  const visibleTasks: Partial<TaskRecord>[] = [];
  for (let index = 0; index < tasks.length; index += 1) {
    if ((searchableTextByTask[index] || "").includes(normalizedSearch)) {
      visibleTasks.push(tasks[index]!);
    }
  }
  return visibleTasks;
}

function sameStringArray(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return !Array.isArray(left) && !Array.isArray(right);
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (String(left[index] || "") !== String(right[index] || "")) {
      return false;
    }
  }
  return true;
}

function taskQuickMarker(task: Partial<TaskRecord>): string {
  const taskId = String(task.task_id || "").trim();
  const status = String(task.status || "").trim();
  const priority = Number.isFinite(task.priority) ? String(Number(task.priority)) : "";
  const ready = task.ready ? "1" : "0";
  const tagsCount = Array.isArray(task.tags) ? task.tags.length : 0;
  const dependsCount = Array.isArray(task.depends_on) ? task.depends_on.length : 0;
  const acceptanceCount = Array.isArray(task.acceptance_criteria)
    ? task.acceptance_criteria.length
    : 0;
  const deliverablesCount = Array.isArray(task.deliverables) ? task.deliverables.length : 0;
  const verificationCount = Array.isArray(task.verification_steps)
    ? task.verification_steps.length
    : 0;
  const scopeCount = Array.isArray(task.files_in_scope) ? task.files_in_scope.length : 0;
  const objectiveFlag = task.objective ? "1" : "0";
  const notesFlag = task.implementation_notes ? "1" : "0";
  return [
    taskId,
    status,
    priority,
    ready,
    String(tagsCount),
    String(dependsCount),
    String(acceptanceCount),
    String(deliverablesCount),
    String(verificationCount),
    String(scopeCount),
    objectiveFlag,
    notesFlag,
  ].join(":");
}

function taskArrayQuickMarker(tasks: Partial<TaskRecord>[]): string {
  if (tasks.length === 0) {
    return "0";
  }
  const middleIndex = Math.floor((tasks.length - 1) / 2);
  return [
    String(tasks.length),
    taskQuickMarker(tasks[0] || {}),
    taskQuickMarker(tasks[middleIndex] || {}),
    taskQuickMarker(tasks[tasks.length - 1] || {}),
  ].join("|");
}

function sameTaskRecord(left: Partial<TaskRecord>, right: Partial<TaskRecord>): boolean {
  return (
    left.task_id === right.task_id &&
    left.title === right.title &&
    left.detail === right.detail &&
    left.objective === right.objective &&
    left.task_type === right.task_type &&
    left.subsystem === right.subsystem &&
    left.priority === right.priority &&
    left.status === right.status &&
    left.ready === right.ready &&
    left.implementation_notes === right.implementation_notes &&
    left.estimated_effort === right.estimated_effort &&
    left.claimed_by_agent_id === right.claimed_by_agent_id &&
    left.suggested_intelligence === right.suggested_intelligence &&
    left.suggested_model === right.suggested_model &&
    sameStringArray(left.tags, right.tags) &&
    sameStringArray(left.depends_on, right.depends_on) &&
    sameStringArray(left.files_in_scope, right.files_in_scope) &&
    sameStringArray(left.out_of_scope, right.out_of_scope) &&
    sameStringArray(left.acceptance_criteria, right.acceptance_criteria) &&
    sameStringArray(left.deliverables, right.deliverables) &&
    sameStringArray(left.verification_steps, right.verification_steps) &&
    sameStringArray(left.risk_notes, right.risk_notes)
  );
}

function sameTaskArray(left: Partial<TaskRecord>[], right: Partial<TaskRecord>[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameTaskRecord(left[index] || {}, right[index] || {})) {
      return false;
    }
  }
  return true;
}

export function createTaskNerveService(): TaskNerveService {
  let taskSnapshotBaseMemo: TaskSnapshotBaseMemo | null = null;
  let taskSnapshotMemo:
    | {
        tasksRef: Partial<TaskRecord>[];
        search: string;
        snapshot: TaskNerveTaskSnapshot;
      }
    | null = null;

  return {
    health: () => ({
      ok: true,
      mode: "codex-native-integration",
      generated_at_utc: nowIsoUtc(),
      capabilities: [
        "project_registry",
        "project_settings",
        "controller_bootstrap",
        "project_contract_templates",
        "task_snapshot",
        "conversation_display",
        "conversation_interaction",
        "project_git_sync",
        "project_ci_sync",
        "project_production",
        "thread_display",
        "prompt_queue",
        "task_quality_gate",
        "model_routing",
      ],
    }),

    buildControllerPrompt: (options) => buildControllerBootstrapPrompt(options),

    renderProjectContracts: (summary) => ({
      project_goals: renderProjectGoalsTemplate(summary),
      project_manifest: renderProjectManifestTemplate(summary),
    }),

    taskSnapshot: (tasks, search = "") => {
      if (taskSnapshotMemo && taskSnapshotMemo.tasksRef === tasks && taskSnapshotMemo.search === search) {
        return taskSnapshotMemo.snapshot;
      }

      let baseMemo = taskSnapshotBaseMemo;
      if (!baseMemo) {
        const allTasks = sortTasks(tasks);
        baseMemo = {
          tasksRef: tasks,
          tasksQuickMarker: taskArrayQuickMarker(tasks),
          allTasks,
          searchableTextByTask: allTasks.map((task) => taskSearchText(task)),
          allStats: buildProjectTaskStats(allTasks),
          userTags: uniqueSorted(allTasks.flatMap((task) => taskUserTags(task))),
          searchCache: new Map(),
        };
        taskSnapshotBaseMemo = baseMemo;
      } else if (baseMemo.tasksRef !== tasks) {
        const quickMarker = taskArrayQuickMarker(tasks);
        if (baseMemo.tasksQuickMarker !== quickMarker || !sameTaskArray(baseMemo.tasksRef, tasks)) {
          const allTasks = sortTasks(tasks);
          baseMemo = {
            tasksRef: tasks,
            tasksQuickMarker: quickMarker,
            allTasks,
            searchableTextByTask: allTasks.map((task) => taskSearchText(task)),
            allStats: buildProjectTaskStats(allTasks),
            userTags: uniqueSorted(allTasks.flatMap((task) => taskUserTags(task))),
            searchCache: new Map(),
          };
          taskSnapshotBaseMemo = baseMemo;
        } else {
          baseMemo.tasksRef = tasks;
        }
      } else {
        baseMemo.tasksRef = tasks;
      }

      const normalizedSearch = normalizeSearchText(search);
      const cachedSearch = baseMemo.searchCache.get(normalizedSearch);
      if (cachedSearch) {
        const exactSnapshot = cachedSearch.snapshotsBySearch.get(search);
        if (exactSnapshot) {
          taskSnapshotMemo = {
            tasksRef: tasks,
            search,
            snapshot: exactSnapshot,
          };
          return exactSnapshot;
        }
        const snapshot: TaskNerveTaskSnapshot = {
          search,
          all_tasks: baseMemo.allTasks,
          visible_tasks: cachedSearch.visibleTasks,
          all_stats: baseMemo.allStats,
          visible_stats: cachedSearch.visibleStats,
          user_tags: baseMemo.userTags,
        };
        if (cachedSearch.snapshotsBySearch.size >= TASK_SNAPSHOT_RAW_SEARCH_VARIANTS_LIMIT) {
          const oldest = cachedSearch.snapshotsBySearch.keys().next().value;
          if (typeof oldest === "string") {
            cachedSearch.snapshotsBySearch.delete(oldest);
          }
        }
        cachedSearch.snapshotsBySearch.set(search, snapshot);
        taskSnapshotMemo = {
          tasksRef: tasks,
          search,
          snapshot,
        };
        return snapshot;
      }

      const visibleTasks = filterSortedTasksBySearch(
        baseMemo.allTasks,
        baseMemo.searchableTextByTask,
        normalizedSearch,
      );
      const hasSearch = Boolean(normalizedSearch);
      const visibleStats = hasSearch ? buildProjectTaskStats(visibleTasks) : baseMemo.allStats;

      if (baseMemo.searchCache.size >= TASK_SNAPSHOT_SEARCH_CACHE_LIMIT) {
        const oldest = baseMemo.searchCache.keys().next().value;
        if (typeof oldest === "string") {
          baseMemo.searchCache.delete(oldest);
        }
      }
      const snapshot: TaskNerveTaskSnapshot = {
        search,
        all_tasks: baseMemo.allTasks,
        visible_tasks: visibleTasks,
        all_stats: baseMemo.allStats,
        visible_stats: visibleStats,
        user_tags: baseMemo.userTags,
      };
      baseMemo.searchCache.set(normalizedSearch, {
        visibleTasks,
        visibleStats,
        snapshotsBySearch: new Map([[search, snapshot]]),
      });
      taskSnapshotMemo = {
        tasksRef: tasks,
        search,
        snapshot,
      };
      return snapshot;
    },

    queuePrompt: (queue, request, options = {}) => mergePromptQueue(queue, request, options),

    gateDispatchTaskIdsByQuality: (options) => {
      const normalizedSettings = normalizeProjectCodexSettings(options.settings);
      return gateTaskDispatchByQuality({
        taskIds: options.task_ids,
        tasks: options.tasks,
        gate: {
          enabled: normalizedSettings.task_quality_gate_enabled,
          minScore: normalizedSettings.task_quality_gate_min_score,
          includeCiTasks: normalizedSettings.task_quality_gate_include_ci,
        },
      });
    },

    resolveModelsForTask: (settings, task = {}) => {
      const normalizedSettings = normalizeProjectCodexSettings(settings);
      return {
        controller_model: resolveControllerModelFromNormalizedSettings(normalizedSettings),
        worker_model: resolveWorkerModelForTaskWithNormalizedSettings(normalizedSettings, task),
      };
    },

    normalizeProjectSettings: (settings) => normalizeProjectCodexSettings(settings),

    loadProjectSettings: (options) => loadProjectCodexSettings(options),

    writeProjectSettings: (repoRoot, settings) => writeProjectCodexSettings(repoRoot, settings),

    loadRegistry: (env = process.env) => loadProjectRegistry(env),

    writeRegistry: (registry, env = process.env) => writeProjectRegistry(registry, env),

    conversationDisplaySnapshot: (options) => buildCodexConversationDisplaySnapshot(options),

    conversationInteractionStep: (input) => conversationInteractionStep(input),

    projectGitSyncSnapshot: (options) => buildCodexProjectGitSyncSnapshot(options),

    projectSettingsAfterGitPush: (options) => buildProjectSettingsAfterCodexGitPush(options),

    projectCiTaskSyncPlan: (options) => buildCodexProjectCiTaskSyncPlan(options),

    projectProductionSnapshot: (options) => buildCodexProjectProductionSnapshot(options),

    projectSettingsAfterCiSync: (options) => buildProjectSettingsAfterCodexCiSync(options),

    threadDisplaySnapshot: (options) => buildThreadDisplaySnapshot(options),
  };
}
