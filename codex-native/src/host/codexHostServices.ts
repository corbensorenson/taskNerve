export const CODEX_HOST_SERVICE_METHODS = [
  "getActiveWorkspaceContext",
  "listProjectThreads",
  "startThread",
  "startTurn",
  "setThreadName",
  "setThreadModel",
  "pinThread",
  "openThread",
  "readRepositorySettings",
  "writeRepositorySettings",
] as const;

export type CodexHostSubscription =
  | (() => void)
  | {
      dispose: () => void;
    }
  | {
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
  subscribeThreadEvents?: (
    listener: (event: unknown) => void,
    options?: { threadId?: string | null },
  ) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
  subscribeRepositorySettingsEvents?: (
    listener: (event: unknown) => void,
  ) => Promise<CodexHostSubscription | void> | CodexHostSubscription | void;
  getCodexStylingContext?: () => Promise<unknown> | unknown;
  readTaskNerveTaskCount?: () => Promise<unknown> | unknown;
  readTaskDrawerState?: () => Promise<unknown> | unknown;
  openTaskDrawer?: () => Promise<unknown> | unknown;
  readTerminalPanelState?: () => Promise<unknown> | unknown;
  toggleTerminalPanel?: () => Promise<unknown> | unknown;
  listTaskNerveBranches?: () => Promise<unknown> | unknown;
  switchTaskNerveBranch?: (branchName: string) => Promise<unknown> | unknown;
  readTaskNerveResourceStats?: () => Promise<unknown> | unknown;
  setConversationCurrentTurnKey?: (turnKey: string) => Promise<unknown> | unknown;
  scrollConversationToTurn?: (
    turnKey: string,
    options?: { behavior?: "auto" | "smooth"; align?: "start" | "center" },
  ) => Promise<unknown> | unknown;
  scrollConversationToTop?: (
    scrollTopPx: number,
    options?: { behavior?: "auto" | "smooth" },
  ) => Promise<unknown> | unknown;
}

export function missingCodexHostServiceMethods(host: Partial<CodexHostServices> | null | undefined) {
  if (!host || typeof host !== "object") {
    return [...CODEX_HOST_SERVICE_METHODS];
  }
  return CODEX_HOST_SERVICE_METHODS.filter((method) => typeof host[method] !== "function");
}

export function assertCodexHostServices(host: Partial<CodexHostServices> | null | undefined) {
  const missing = missingCodexHostServiceMethods(host);
  if (missing.length > 0) {
    throw new Error(`Codex host services are incomplete: ${missing.join(", ")}`);
  }
  return host as CodexHostServices;
}
