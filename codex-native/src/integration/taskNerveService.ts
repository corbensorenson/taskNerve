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
  filterTasks,
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
  threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => ThreadDisplaySnapshot;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function createTaskNerveService(): TaskNerveService {
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
        "thread_display",
        "prompt_queue",
        "model_routing",
      ],
    }),

    buildControllerPrompt: (options) => buildControllerBootstrapPrompt(options),

    renderProjectContracts: (summary) => ({
      project_goals: renderProjectGoalsTemplate(summary),
      project_manifest: renderProjectManifestTemplate(summary),
    }),

    taskSnapshot: (tasks, search = "") => {
      const allTasks = sortTasks(tasks);
      const visibleTasks = filterTasks(allTasks, search, { alreadySorted: true });
      const hasSearch = Boolean(search.trim());
      const allStats = buildProjectTaskStats(allTasks);
      return {
        search,
        all_tasks: allTasks,
        visible_tasks: visibleTasks,
        all_stats: allStats,
        visible_stats: hasSearch ? buildProjectTaskStats(visibleTasks) : allStats,
        user_tags: uniqueSorted(allTasks.flatMap((task) => taskUserTags(task))),
      };
    },

    queuePrompt: (queue, request, options = {}) => mergePromptQueue(queue, request, options),

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

    threadDisplaySnapshot: (options) => buildThreadDisplaySnapshot(options),
  };
}
