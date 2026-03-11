export declare const CODEX_HOST_SERVICE_METHODS: readonly ["getActiveWorkspaceContext", "listProjectThreads", "startThread", "startTurn", "setThreadName", "setThreadModel", "pinThread", "openThread", "readRepositorySettings", "writeRepositorySettings"];
export type CodexHostSubscription = (() => void) | {
    dispose: () => void;
} | {
    unsubscribe: () => void;
};
export interface CodexHostServices {
    getActiveWorkspaceContext: () => Promise<unknown> | unknown;
    listProjectThreads: () => Promise<unknown> | unknown;
    startThread: (options: unknown) => Promise<unknown> | unknown;
    startTurn: (options: unknown) => Promise<unknown> | unknown;
    setThreadName: (threadId: string, title: string) => Promise<unknown> | unknown;
    setThreadModel: (threadId: string, model: string) => Promise<unknown> | unknown;
    pinThread: (threadId: string) => Promise<unknown> | unknown;
    openThread: (threadId: string) => Promise<unknown> | unknown;
    readRepositorySettings: () => Promise<unknown> | unknown;
    writeRepositorySettings: (settings: unknown) => Promise<unknown> | unknown;
    subscribeThreadEvents?: (listener: (event: unknown) => void, options?: {
        threadId?: string | null;
    }) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    subscribeRepositorySettingsEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    getCodexStylingContext?: () => Promise<unknown> | unknown;
    readTaskNerveTaskCount?: () => Promise<unknown> | unknown;
    subscribeTaskNerveTaskCountEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    readTaskDrawerState?: () => Promise<unknown> | unknown;
    subscribeTaskDrawerStateEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    openTaskDrawer?: () => Promise<unknown> | unknown;
    readTerminalPanelState?: () => Promise<unknown> | unknown;
    subscribeTerminalPanelStateEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    toggleTerminalPanel?: () => Promise<unknown> | unknown;
    listTaskNerveBranches?: () => Promise<unknown> | unknown;
    subscribeTaskNerveBranchEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    switchTaskNerveBranch?: (branchName: string) => Promise<unknown> | unknown;
    readTaskNerveResourceStats?: () => Promise<unknown> | unknown;
    subscribeTaskNerveResourceStatsEvents?: (listener: (event: unknown) => void) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
    setConversationCurrentTurnKey?: (turnKey: string) => Promise<unknown> | unknown;
    scrollConversationToTurn?: (turnKey: string, options?: {
        behavior?: "auto" | "smooth";
        align?: "start" | "center";
    }) => Promise<unknown> | unknown;
    scrollConversationToTop?: (scrollTopPx: number, options?: {
        behavior?: "auto" | "smooth";
    }) => Promise<unknown> | unknown;
}
export declare function missingCodexHostServiceMethods(host: Partial<CodexHostServices> | null | undefined): ("getActiveWorkspaceContext" | "listProjectThreads" | "startThread" | "startTurn" | "setThreadName" | "setThreadModel" | "pinThread" | "openThread" | "readRepositorySettings" | "writeRepositorySettings")[];
export declare function assertCodexHostServices(host: Partial<CodexHostServices> | null | undefined): CodexHostServices;
//# sourceMappingURL=codexHostServices.d.ts.map