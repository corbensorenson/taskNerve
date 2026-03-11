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
];
export function missingCodexHostServiceMethods(host) {
    if (!host || typeof host !== "object") {
        return [...CODEX_HOST_SERVICE_METHODS];
    }
    return CODEX_HOST_SERVICE_METHODS.filter((method) => typeof host[method] !== "function");
}
export function assertCodexHostServices(host) {
    const missing = missingCodexHostServiceMethods(host);
    if (missing.length > 0) {
        throw new Error(`Codex host services are incomplete: ${missing.join(", ")}`);
    }
    return host;
}
//# sourceMappingURL=codexHostServices.js.map