import { type CodexHostServices } from "../host/codexHostServices.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type { CodexConversationChromeSnapshot, CodexConversationChromeStateInput } from "./codexConversationChrome.js";
import type { CodexConversationDisplayOptions, CodexConversationDisplaySnapshot } from "./codexConversationDisplay.js";
import type { CodexConversationInteractionInput, CodexConversationInteractionResult } from "./codexConversationInteraction.js";
import { type TaskNerveService } from "./taskNerveService.js";
import type { BuildThreadDisplayOptions, ThreadDisplaySnapshot } from "./threadDisplay/index.js";
export interface CodexTaskNerveSnapshotOptions {
    repoRoot: string;
    projectName: string;
    tasks: Partial<TaskRecord>[];
    search?: string;
    gitOriginUrl?: string | null;
}
export interface CodexTaskNerveSnapshot {
    integration_mode: "codex-native-host";
    styling: {
        inherit_codex_host: true;
        render_mode: "host-components-only";
    };
    host_styling_context: unknown;
    project_name: string;
    repo_root: string;
    settings: ProjectCodexSettings;
    task_snapshot: ReturnType<TaskNerveService["taskSnapshot"]>;
}
export interface CodexControllerBootstrapOptions {
    repoRoot: string;
    projectName: string;
    projectGoalsPath?: string;
    projectManifestPath?: string;
    currentStateSignals?: string[];
    timelineSignals?: string[];
    queueSummary?: string;
    maintenanceCadence?: string;
    heartbeatCore?: string | null;
    lowQueuePrompt?: string;
    threadTitle?: string;
}
export interface CodexControllerBootstrapResult {
    integration_mode: "codex-native-host";
    thread_id: string;
    thread_title: string;
    controller_model: string | null;
    prompt: string;
}
export type CodexConversationChromeAction = {
    type: "topbar-task-count-click";
} | {
    type: "footer-terminal-toggle-click";
} | {
    type: "footer-branch-switch";
    branch: string;
};
export interface CodexConversationChromeActionResult {
    ok: boolean;
    integration_mode: "codex-native-host";
    action: CodexConversationChromeAction["type"];
    task_drawer_open?: boolean;
    terminal_open?: boolean;
    branch?: string;
    error?: string;
}
export interface CodexHostRefreshSubscription {
    mode: "host-event-subscription" | "fallback-manual-refresh";
    dispose: () => void;
}
export interface ObserveThreadRefreshOptions {
    threadId?: string | null;
    onEvent: (event: unknown) => void;
    onFallbackRefresh?: () => void;
}
export interface ObserveRepositorySettingsRefreshOptions {
    onEvent: (event: unknown) => void;
    onFallbackRefresh?: () => void;
}
export type CodexConversationChromeRefreshSource = "task-count" | "task-drawer" | "terminal-panel" | "branch-state" | "resource-stats";
export interface CodexConversationChromeRefreshEvent {
    source: CodexConversationChromeRefreshSource;
    payload: unknown;
}
export interface ObserveConversationChromeRefreshOptions {
    onEvent: (event: CodexConversationChromeRefreshEvent) => void;
    onFallbackRefresh?: () => void;
}
export interface CodexTaskNerveHostRuntime {
    snapshot: (options: CodexTaskNerveSnapshotOptions) => Promise<CodexTaskNerveSnapshot>;
    bootstrapControllerThread: (options: CodexControllerBootstrapOptions) => Promise<CodexControllerBootstrapResult>;
    conversationDisplaySnapshot: (options: CodexConversationDisplayOptions) => Promise<CodexConversationDisplaySnapshot>;
    conversationInteractionStep: (input: CodexConversationInteractionInput) => Promise<CodexConversationInteractionResult>;
    applyConversationInteraction: (input: CodexConversationInteractionInput) => Promise<CodexConversationInteractionResult & {
        apply_summary: {
            applied: number;
            skipped: number;
        };
    }>;
    threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => Promise<ThreadDisplaySnapshot>;
    conversationChromeSnapshot: (options?: CodexConversationChromeStateInput) => Promise<CodexConversationChromeSnapshot>;
    handleConversationChromeAction: (action: CodexConversationChromeAction) => Promise<CodexConversationChromeActionResult>;
    observeThreadRefresh: (options: ObserveThreadRefreshOptions) => Promise<CodexHostRefreshSubscription>;
    observeRepositorySettingsRefresh: (options: ObserveRepositorySettingsRefreshOptions) => Promise<CodexHostRefreshSubscription>;
    observeConversationChromeRefresh: (options: ObserveConversationChromeRefreshOptions) => Promise<CodexHostRefreshSubscription>;
}
export declare function createCodexTaskNerveHostRuntime(options: {
    host: Partial<CodexHostServices> | null | undefined;
    taskNerveService?: TaskNerveService;
}): CodexTaskNerveHostRuntime;
//# sourceMappingURL=codexTaskNerveHostRuntime.d.ts.map