import { type ControllerBootstrapOptions } from "../domain/controllerBootstrap.js";
import { type ProjectContractSummary } from "../domain/projectContracts.js";
import { buildProjectTaskStats, mergePromptQueue } from "../domain/taskQueue.js";
import type { ProjectCodexSettings, ProjectRegistry, PromptQueueRequest, TaskRecord } from "../schemas.js";
import { type BuildThreadDisplayOptions, type ThreadDisplaySnapshot } from "./threadDisplay/index.js";
import { type CodexConversationDisplayOptions, type CodexConversationDisplaySnapshot } from "./codexConversationDisplay.js";
import { type CodexConversationInteractionInput, type CodexConversationInteractionResult } from "./codexConversationInteraction.js";
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
    queuePrompt: (queue: Partial<PromptQueueRequest>[], request: Partial<PromptQueueRequest>, options?: {
        singleMessageMode?: boolean;
    }) => ReturnType<typeof mergePromptQueue>;
    resolveModelsForTask: (settings: Partial<ProjectCodexSettings>, task?: Partial<TaskRecord>) => {
        controller_model: string | null;
        worker_model: string | null;
    };
    normalizeProjectSettings: (settings: Partial<ProjectCodexSettings>) => ProjectCodexSettings;
    loadProjectSettings: (options: {
        repoRoot: string;
        gitOriginUrl?: string | null;
    }) => Promise<ProjectCodexSettings>;
    writeProjectSettings: (repoRoot: string, settings: Partial<ProjectCodexSettings>) => Promise<ProjectCodexSettings>;
    loadRegistry: (env?: NodeJS.ProcessEnv) => Promise<ProjectRegistry>;
    writeRegistry: (registry: ProjectRegistry, env?: NodeJS.ProcessEnv) => Promise<ProjectRegistry>;
    conversationDisplaySnapshot: (options: CodexConversationDisplayOptions) => CodexConversationDisplaySnapshot;
    conversationInteractionStep: (input: CodexConversationInteractionInput) => CodexConversationInteractionResult;
    threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => ThreadDisplaySnapshot;
}
export declare function createTaskNerveService(): TaskNerveService;
//# sourceMappingURL=taskNerveService.d.ts.map