import { nowIsoUtc } from "../constants.js";
import { buildControllerBootstrapPrompt, } from "../domain/controllerBootstrap.js";
import { renderProjectGoalsTemplate, renderProjectManifestTemplate, } from "../domain/projectContracts.js";
import { buildProjectTaskStats, filterTasks, mergePromptQueue, sortTasks, taskUserTags, } from "../domain/taskQueue.js";
import { normalizeProjectCodexSettings, resolveControllerModelFromNormalizedSettings, resolveWorkerModelForTaskWithNormalizedSettings, } from "../domain/projectCodexSettings.js";
import { loadProjectCodexSettings, writeProjectCodexSettings } from "../io/projectCodexSettingsStore.js";
import { loadProjectRegistry, writeProjectRegistry } from "../io/projectRegistryStore.js";
import { buildThreadDisplaySnapshot, } from "./threadDisplay/index.js";
import { buildCodexConversationDisplaySnapshot, } from "./codexConversationDisplay.js";
import { conversationInteractionStep, } from "./codexConversationInteraction.js";
function uniqueSorted(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
const TASK_SNAPSHOT_SEARCH_CACHE_LIMIT = 12;
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry || "")) : [];
}
function sameStringArray(left, right) {
    const leftValues = normalizeStringArray(left);
    const rightValues = normalizeStringArray(right);
    if (leftValues.length !== rightValues.length) {
        return false;
    }
    for (let index = 0; index < leftValues.length; index += 1) {
        if (leftValues[index] !== rightValues[index]) {
            return false;
        }
    }
    return true;
}
function sameTaskRecord(left, right) {
    return (left.task_id === right.task_id &&
        left.title === right.title &&
        left.detail === right.detail &&
        left.priority === right.priority &&
        left.status === right.status &&
        left.ready === right.ready &&
        left.claimed_by_agent_id === right.claimed_by_agent_id &&
        left.suggested_intelligence === right.suggested_intelligence &&
        left.suggested_model === right.suggested_model &&
        sameStringArray(left.tags, right.tags) &&
        sameStringArray(left.depends_on, right.depends_on));
}
function sameTaskArray(left, right) {
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
export function createTaskNerveService() {
    let taskSnapshotBaseMemo = null;
    let taskSnapshotMemo = null;
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
            if (taskSnapshotMemo && taskSnapshotMemo.tasksRef === tasks && taskSnapshotMemo.search === search) {
                return taskSnapshotMemo.snapshot;
            }
            let baseMemo = taskSnapshotBaseMemo;
            if (!baseMemo || (baseMemo.tasksRef !== tasks && !sameTaskArray(baseMemo.tasksRef, tasks))) {
                const allTasks = sortTasks(tasks);
                baseMemo = {
                    tasksRef: tasks,
                    allTasks,
                    allStats: buildProjectTaskStats(allTasks),
                    userTags: uniqueSorted(allTasks.flatMap((task) => taskUserTags(task))),
                    searchCache: new Map(),
                };
                taskSnapshotBaseMemo = baseMemo;
            }
            else if (baseMemo.tasksRef !== tasks) {
                baseMemo.tasksRef = tasks;
            }
            const cachedSearch = baseMemo.searchCache.get(search);
            if (cachedSearch) {
                taskSnapshotMemo = {
                    tasksRef: tasks,
                    search,
                    snapshot: cachedSearch.snapshot,
                };
                return cachedSearch.snapshot;
            }
            const visibleTasks = filterTasks(baseMemo.allTasks, search, { alreadySorted: true });
            const hasSearch = Boolean(search.trim());
            const visibleStats = hasSearch ? buildProjectTaskStats(visibleTasks) : baseMemo.allStats;
            if (baseMemo.searchCache.size >= TASK_SNAPSHOT_SEARCH_CACHE_LIMIT) {
                const oldest = baseMemo.searchCache.keys().next().value;
                if (typeof oldest === "string") {
                    baseMemo.searchCache.delete(oldest);
                }
            }
            const snapshot = {
                search,
                all_tasks: baseMemo.allTasks,
                visible_tasks: visibleTasks,
                all_stats: baseMemo.allStats,
                visible_stats: visibleStats,
                user_tags: baseMemo.userTags,
            };
            baseMemo.searchCache.set(search, {
                visibleTasks,
                visibleStats,
                snapshot,
            });
            taskSnapshotMemo = {
                tasksRef: tasks,
                search,
                snapshot,
            };
            return snapshot;
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
        conversationDisplaySnapshot: (options) => buildCodexConversationDisplaySnapshot(options),
        conversationInteractionStep: (input) => conversationInteractionStep(input),
        threadDisplaySnapshot: (options) => buildThreadDisplaySnapshot(options),
    };
}
//# sourceMappingURL=taskNerveService.js.map