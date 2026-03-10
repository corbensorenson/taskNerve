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
