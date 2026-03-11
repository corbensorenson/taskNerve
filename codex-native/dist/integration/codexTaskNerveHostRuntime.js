import { CONTROLLER_AGENT_ID } from "../constants.js";
import { assertCodexHostServices, } from "../host/codexHostServices.js";
import { buildCodexConversationChromeSnapshot } from "./codexConversationChrome.js";
import { createTaskNerveService } from "./taskNerveService.js";
const HOST_STYLING_CONTEXT_CACHE_TTL_MS = 10_000;
const CONVERSATION_CHROME_CACHE_TTL_MS = 250;
const RESOURCE_STATS_CACHE_TTL_MS = 1_000;
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function parseThreadId(value) {
    const payload = asRecord(value);
    if (!payload) {
        return null;
    }
    const direct = payload.thread_id;
    if (typeof direct === "string" && direct.trim()) {
        return direct;
    }
    const camel = payload.threadId;
    if (typeof camel === "string" && camel.trim()) {
        return camel;
    }
    const nested = asRecord(payload.thread);
    if (nested) {
        if (typeof nested.id === "string" && nested.id.trim()) {
            return nested.id;
        }
        if (typeof nested.thread_id === "string" && nested.thread_id.trim()) {
            return nested.thread_id;
        }
    }
    const id = payload.id;
    return typeof id === "string" && id.trim() ? id : null;
}
function parseTaskCount(value) {
    if (Number.isFinite(value)) {
        return Math.max(0, Math.round(Number(value)));
    }
    if (Array.isArray(value)) {
        return value.length;
    }
    const record = asRecord(value);
    if (!record) {
        return 0;
    }
    const candidates = [
        record.taskCount,
        record.task_count,
        record.pendingTaskCount,
        record.pending_task_count,
        record.count,
    ];
    for (const candidate of candidates) {
        if (Number.isFinite(candidate)) {
            return Math.max(0, Math.round(Number(candidate)));
        }
    }
    return 0;
}
function parseTaskCountMaybe(value) {
    if (Number.isFinite(value)) {
        return Math.max(0, Math.round(Number(value)));
    }
    if (Array.isArray(value)) {
        return value.length;
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const candidates = [
        record.taskCount,
        record.task_count,
        record.pendingTaskCount,
        record.pending_task_count,
        record.count,
    ];
    for (const candidate of candidates) {
        if (Number.isFinite(candidate)) {
            return Math.max(0, Math.round(Number(candidate)));
        }
    }
    return null;
}
function parseOpenState(value, fallback = false) {
    if (typeof value === "boolean") {
        return value;
    }
    const record = asRecord(value);
    if (!record) {
        return fallback;
    }
    const candidates = [record.open, record.isOpen, record.drawer_open, record.task_drawer_open];
    for (const candidate of candidates) {
        if (typeof candidate === "boolean") {
            return candidate;
        }
    }
    return fallback;
}
function parseOpenStateMaybe(value) {
    if (typeof value === "boolean") {
        return value;
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const candidates = [record.open, record.isOpen, record.drawer_open, record.task_drawer_open];
    for (const candidate of candidates) {
        if (typeof candidate === "boolean") {
            return candidate;
        }
    }
    return null;
}
function parseBranchState(value) {
    if (Array.isArray(value)) {
        const branches = value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
        return {
            currentBranch: branches[0] || null,
            branches,
        };
    }
    const record = asRecord(value);
    if (!record) {
        return { currentBranch: null, branches: [] };
    }
    const rawBranches = Array.isArray(record.branches)
        ? record.branches
        : Array.isArray(record.branchNames)
            ? record.branchNames
            : [];
    const branches = rawBranches
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
    const currentCandidates = [
        record.current,
        record.currentBranch,
        record.current_branch,
        record.activeBranch,
        record.active_branch,
    ];
    const currentBranch = currentCandidates.find((entry) => typeof entry === "string" && entry.trim());
    return {
        currentBranch: currentBranch?.trim() || branches[0] || null,
        branches,
    };
}
function parseBranchStatePatch(value) {
    if (Array.isArray(value)) {
        const branches = value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
        return {
            currentBranch: branches[0] || null,
            branches,
        };
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    let branches;
    if (Array.isArray(record.branches)) {
        branches = record.branches
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
    }
    else if (Array.isArray(record.branchNames)) {
        branches = record.branchNames
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
    }
    let currentBranch;
    const currentCandidates = [
        record.current,
        record.currentBranch,
        record.current_branch,
        record.activeBranch,
        record.active_branch,
    ];
    for (const candidate of currentCandidates) {
        if (typeof candidate === "string") {
            const normalized = candidate.trim();
            currentBranch = normalized || null;
            break;
        }
    }
    if (branches === undefined && currentBranch === undefined) {
        return null;
    }
    const patch = {};
    if (branches !== undefined) {
        patch.branches = branches;
        if (currentBranch === undefined) {
            patch.currentBranch = branches[0] || null;
        }
    }
    if (currentBranch !== undefined) {
        patch.currentBranch = currentBranch;
    }
    return patch;
}
function parseResourceStats(value) {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    return {
        cpuPercent: Number.isFinite(record.cpuPercent)
            ? Number(record.cpuPercent)
            : Number.isFinite(record.cpu_percent)
                ? Number(record.cpu_percent)
                : null,
        gpuPercent: Number.isFinite(record.gpuPercent)
            ? Number(record.gpuPercent)
            : Number.isFinite(record.gpu_percent)
                ? Number(record.gpu_percent)
                : null,
        memoryPercent: Number.isFinite(record.memoryPercent)
            ? Number(record.memoryPercent)
            : Number.isFinite(record.memory_percent)
                ? Number(record.memory_percent)
                : null,
        thermalPressure: typeof record.thermalPressure === "string" && record.thermalPressure.trim()
            ? record.thermalPressure.trim()
            : typeof record.thermal_pressure === "string" && record.thermal_pressure.trim()
                ? record.thermal_pressure.trim()
                : null,
        capturedAtUtc: typeof record.capturedAtUtc === "string" && record.capturedAtUtc.trim()
            ? record.capturedAtUtc.trim()
            : typeof record.captured_at_utc === "string" && record.captured_at_utc.trim()
                ? record.captured_at_utc.trim()
                : null,
    };
}
function parseResourceStatsPatch(value) {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const patch = {};
    if ("cpuPercent" in record || "cpu_percent" in record) {
        const candidate = record.cpuPercent ?? record.cpu_percent;
        patch.cpuPercent = Number.isFinite(candidate) ? Number(candidate) : null;
    }
    if ("gpuPercent" in record || "gpu_percent" in record) {
        const candidate = record.gpuPercent ?? record.gpu_percent;
        patch.gpuPercent = Number.isFinite(candidate) ? Number(candidate) : null;
    }
    if ("memoryPercent" in record || "memory_percent" in record) {
        const candidate = record.memoryPercent ?? record.memory_percent;
        patch.memoryPercent = Number.isFinite(candidate) ? Number(candidate) : null;
    }
    if ("thermalPressure" in record || "thermal_pressure" in record) {
        const candidate = record.thermalPressure ?? record.thermal_pressure;
        patch.thermalPressure =
            typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
    }
    if ("capturedAtUtc" in record || "captured_at_utc" in record) {
        const candidate = record.capturedAtUtc ?? record.captured_at_utc;
        patch.capturedAtUtc = typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}
function sameStringArray(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return !left && !right;
    }
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
function sameResourceStats(left, right) {
    return ((left?.cpuPercent ?? undefined) === (right?.cpuPercent ?? undefined) &&
        (left?.gpuPercent ?? undefined) === (right?.gpuPercent ?? undefined) &&
        (left?.memoryPercent ?? undefined) === (right?.memoryPercent ?? undefined) &&
        (left?.thermalPressure ?? undefined) === (right?.thermalPressure ?? undefined) &&
        (left?.capturedAtUtc ?? undefined) === (right?.capturedAtUtc ?? undefined));
}
function normalizeHostSubscriptionDisposer(value) {
    if (typeof value === "function") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return () => { };
    }
    if ("dispose" in value && typeof value.dispose === "function") {
        return () => value.dispose();
    }
    if ("unsubscribe" in value && typeof value.unsubscribe === "function") {
        return () => value.unsubscribe();
    }
    return () => { };
}
function hasConversationChromeOverrides(input) {
    return (input.taskCount !== undefined ||
        input.taskDrawerOpen !== undefined ||
        input.terminalOpen !== undefined ||
        input.currentBranch !== undefined ||
        input.branches !== undefined ||
        input.resourceStats !== undefined);
}
export function createCodexTaskNerveHostRuntime(options) {
    const host = assertCodexHostServices(options.host);
    const taskNerve = options.taskNerveService ?? createTaskNerveService();
    let hostStylingContextCache = null;
    let hostStylingContextInflight = null;
    let conversationChromeSnapshotCache = null;
    let conversationChromeSnapshotInflight = null;
    let resourceStatsCache = null;
    let resourceStatsInflight = null;
    const conversationChromeEventState = {};
    function mergedConversationChromeStateInput(input = {}) {
        return {
            taskCount: input.taskCount !== undefined ? input.taskCount : conversationChromeEventState.taskCount,
            taskDrawerOpen: input.taskDrawerOpen !== undefined
                ? input.taskDrawerOpen
                : conversationChromeEventState.taskDrawerOpen,
            terminalOpen: input.terminalOpen !== undefined
                ? input.terminalOpen
                : conversationChromeEventState.terminalOpen,
            currentBranch: input.currentBranch !== undefined
                ? input.currentBranch
                : conversationChromeEventState.currentBranch,
            branches: input.branches !== undefined ? input.branches : conversationChromeEventState.branches,
            resourceStats: input.resourceStats !== undefined
                ? input.resourceStats
                : conversationChromeEventState.resourceStats,
        };
    }
    async function loadHostStylingContext() {
        if (typeof host.getCodexStylingContext !== "function") {
            return null;
        }
        const now = Date.now();
        if (hostStylingContextCache &&
            now - hostStylingContextCache.fetchedAtMs < HOST_STYLING_CONTEXT_CACHE_TTL_MS) {
            return hostStylingContextCache.value;
        }
        if (hostStylingContextInflight) {
            return hostStylingContextInflight;
        }
        hostStylingContextInflight = Promise.resolve(host.getCodexStylingContext())
            .then((value) => {
            hostStylingContextCache = {
                value,
                fetchedAtMs: Date.now(),
            };
            return value;
        })
            .finally(() => {
            hostStylingContextInflight = null;
        });
        return hostStylingContextInflight;
    }
    async function loadTaskCount(override) {
        if (Number.isFinite(override)) {
            return parseTaskCount(override);
        }
        if (typeof host.readTaskNerveTaskCount !== "function") {
            return 0;
        }
        return parseTaskCount(await host.readTaskNerveTaskCount());
    }
    async function loadTaskDrawerOpen(override) {
        if (typeof override === "boolean") {
            return override;
        }
        if (typeof host.readTaskDrawerState !== "function") {
            return false;
        }
        return parseOpenState(await host.readTaskDrawerState(), false);
    }
    async function loadTerminalOpen(override) {
        if (typeof override === "boolean") {
            return override;
        }
        if (typeof host.readTerminalPanelState !== "function") {
            return false;
        }
        return parseOpenState(await host.readTerminalPanelState(), false);
    }
    async function loadBranches(overrides) {
        if (overrides.currentBranch || (overrides.branches && overrides.branches.length > 0)) {
            return {
                currentBranch: overrides.currentBranch || null,
                branches: overrides.branches || [],
            };
        }
        if (typeof host.listTaskNerveBranches !== "function") {
            return { currentBranch: null, branches: [] };
        }
        return parseBranchState(await host.listTaskNerveBranches());
    }
    async function loadResourceStats(override) {
        if (override) {
            return override;
        }
        if (typeof host.readTaskNerveResourceStats !== "function") {
            return {};
        }
        const now = Date.now();
        if (resourceStatsCache && now - resourceStatsCache.fetchedAtMs < RESOURCE_STATS_CACHE_TTL_MS) {
            return resourceStatsCache.value;
        }
        if (resourceStatsInflight) {
            return resourceStatsInflight;
        }
        resourceStatsInflight = Promise.resolve(host.readTaskNerveResourceStats())
            .then((value) => {
            const normalized = parseResourceStats(value);
            resourceStatsCache = {
                value: normalized,
                fetchedAtMs: Date.now(),
            };
            return normalized;
        })
            .finally(() => {
            resourceStatsInflight = null;
        });
        return resourceStatsInflight;
    }
    async function subscribeWithFallback(options) {
        const subscribe = typeof options.subscribe === "function"
            ? options.subscribe
            : null;
        if (!subscribe) {
            if (typeof options.onFallbackRefresh === "function") {
                options.onFallbackRefresh();
            }
            return {
                mode: "fallback-manual-refresh",
                dispose: () => { },
            };
        }
        const subscription = await Promise.resolve(subscribe(options.listener, ...(options.subscribeArgs ?? [])));
        return {
            mode: "host-event-subscription",
            dispose: normalizeHostSubscriptionDisposer(subscription),
        };
    }
    async function subscribeOptional(options) {
        const subscribe = typeof options.subscribe === "function"
            ? options.subscribe
            : null;
        if (!subscribe) {
            return null;
        }
        const subscription = await Promise.resolve(subscribe(options.listener, ...(options.subscribeArgs ?? [])));
        return normalizeHostSubscriptionDisposer(subscription);
    }
    async function loadConversationChromeSnapshot(stateInput = {}) {
        const [taskCount, taskDrawerOpen, terminalOpen, branchState, resourceStats] = await Promise.all([
            loadTaskCount(stateInput.taskCount),
            loadTaskDrawerOpen(stateInput.taskDrawerOpen),
            loadTerminalOpen(stateInput.terminalOpen),
            loadBranches({
                currentBranch: stateInput.currentBranch,
                branches: stateInput.branches,
            }),
            loadResourceStats(stateInput.resourceStats),
        ]);
        return buildCodexConversationChromeSnapshot({
            taskCount,
            taskDrawerOpen,
            terminalOpen,
            currentBranch: branchState.currentBranch,
            branches: branchState.branches,
            resourceStats,
        });
    }
    function invalidateConversationChromeCache() {
        conversationChromeSnapshotCache = null;
    }
    function applyConversationChromeEventPatch(patch) {
        let changed = false;
        if (patch.taskCount !== undefined &&
            patch.taskCount !== conversationChromeEventState.taskCount) {
            conversationChromeEventState.taskCount = patch.taskCount;
            changed = true;
        }
        if (patch.taskDrawerOpen !== undefined &&
            patch.taskDrawerOpen !== conversationChromeEventState.taskDrawerOpen) {
            conversationChromeEventState.taskDrawerOpen = patch.taskDrawerOpen;
            changed = true;
        }
        if (patch.terminalOpen !== undefined &&
            patch.terminalOpen !== conversationChromeEventState.terminalOpen) {
            conversationChromeEventState.terminalOpen = patch.terminalOpen;
            changed = true;
        }
        if (patch.currentBranch !== undefined &&
            patch.currentBranch !== conversationChromeEventState.currentBranch) {
            conversationChromeEventState.currentBranch = patch.currentBranch;
            changed = true;
        }
        if (patch.branches !== undefined &&
            !sameStringArray(patch.branches, conversationChromeEventState.branches)) {
            conversationChromeEventState.branches = patch.branches;
            changed = true;
        }
        if (patch.resourceStats !== undefined) {
            const previousStats = conversationChromeEventState.resourceStats ?? undefined;
            const nextStats = {
                ...(previousStats ?? {}),
                ...(patch.resourceStats ?? {}),
            };
            if (!sameResourceStats(previousStats, nextStats)) {
                conversationChromeEventState.resourceStats = nextStats;
                resourceStatsCache = {
                    value: nextStats,
                    fetchedAtMs: Date.now(),
                };
                changed = true;
            }
        }
        if (changed) {
            invalidateConversationChromeCache();
        }
        return changed;
    }
    async function applyConversationInteractionCommand(command) {
        switch (command.type) {
            case "set-current-turn-key": {
                if (typeof host.setConversationCurrentTurnKey !== "function") {
                    return false;
                }
                await host.setConversationCurrentTurnKey(command.turnKey);
                return true;
            }
            case "scroll-to-turn": {
                if (typeof host.scrollConversationToTurn !== "function") {
                    return false;
                }
                await host.scrollConversationToTurn(command.turnKey, {
                    behavior: command.behavior,
                    align: command.align,
                });
                return true;
            }
            case "scroll-to-top": {
                if (typeof host.scrollConversationToTop !== "function") {
                    return false;
                }
                await host.scrollConversationToTop(command.scrollTopPx, {
                    behavior: command.behavior,
                });
                return true;
            }
        }
    }
    return {
        snapshot: async (snapshotOptions) => {
            const settingsPromise = taskNerve.loadProjectSettings({
                repoRoot: snapshotOptions.repoRoot,
                gitOriginUrl: snapshotOptions.gitOriginUrl,
            });
            const hostStylingContextPromise = loadHostStylingContext();
            const taskSnapshot = taskNerve.taskSnapshot(snapshotOptions.tasks, snapshotOptions.search || "");
            const [settings, hostStylingContext] = await Promise.all([
                settingsPromise,
                hostStylingContextPromise,
            ]);
            return {
                integration_mode: "codex-native-host",
                styling: {
                    inherit_codex_host: true,
                    render_mode: "host-components-only",
                },
                host_styling_context: hostStylingContext,
                project_name: snapshotOptions.projectName,
                repo_root: snapshotOptions.repoRoot,
                settings,
                task_snapshot: taskSnapshot,
            };
        },
        bootstrapControllerThread: async (bootstrapOptions) => {
            const settings = await taskNerve.loadProjectSettings({
                repoRoot: bootstrapOptions.repoRoot,
            });
            const controllerModel = taskNerve.resolveModelsForTask(settings).controller_model;
            const prompt = taskNerve.buildControllerPrompt({
                projectName: bootstrapOptions.projectName,
                repoRoot: bootstrapOptions.repoRoot,
                projectGoalsPath: bootstrapOptions.projectGoalsPath,
                projectManifestPath: bootstrapOptions.projectManifestPath,
                currentStateSignals: bootstrapOptions.currentStateSignals,
                timelineSignals: bootstrapOptions.timelineSignals,
                queueSummary: bootstrapOptions.queueSummary,
                maintenanceCadence: bootstrapOptions.maintenanceCadence,
                heartbeatCore: bootstrapOptions.heartbeatCore,
                lowQueuePrompt: bootstrapOptions.lowQueuePrompt,
            });
            const title = bootstrapOptions.threadTitle?.trim() || `${bootstrapOptions.projectName} TaskNerve Controller`;
            const threadPayload = await host.startThread({
                title,
                role: "controller",
                agent_id: CONTROLLER_AGENT_ID,
                metadata: {
                    source: "tasknerve.codex-native-host-runtime",
                    repo_root: bootstrapOptions.repoRoot,
                    project_name: bootstrapOptions.projectName,
                },
            });
            const threadId = parseThreadId(threadPayload);
            if (!threadId) {
                throw new Error("Codex host startThread did not return a thread identifier");
            }
            const beforeTurnOps = [host.setThreadName(threadId, title)];
            if (controllerModel) {
                beforeTurnOps.push(host.setThreadModel(threadId, controllerModel));
            }
            await Promise.all(beforeTurnOps);
            await host.startTurn({
                thread_id: threadId,
                threadId,
                agent_id: CONTROLLER_AGENT_ID,
                model: controllerModel || undefined,
                prompt,
            });
            await Promise.all([host.pinThread(threadId), host.openThread(threadId)]);
            return {
                integration_mode: "codex-native-host",
                thread_id: threadId,
                thread_title: title,
                controller_model: controllerModel,
                prompt,
            };
        },
        threadDisplaySnapshot: async (displayOptions) => {
            return taskNerve.threadDisplaySnapshot(displayOptions);
        },
        conversationDisplaySnapshot: async (displayOptions) => {
            return taskNerve.conversationDisplaySnapshot(displayOptions);
        },
        conversationInteractionStep: async (input) => {
            return taskNerve.conversationInteractionStep(input);
        },
        applyConversationInteraction: async (input) => {
            const interaction = taskNerve.conversationInteractionStep(input);
            let applied = 0;
            for (const command of interaction.commands) {
                if (await applyConversationInteractionCommand(command)) {
                    applied += 1;
                }
            }
            return {
                ...interaction,
                apply_summary: {
                    applied,
                    skipped: interaction.commands.length - applied,
                },
            };
        },
        conversationChromeSnapshot: async (stateInput = {}) => {
            const effectiveStateInput = mergedConversationChromeStateInput(stateInput);
            if (hasConversationChromeOverrides(stateInput)) {
                return loadConversationChromeSnapshot(effectiveStateInput);
            }
            const now = Date.now();
            if (conversationChromeSnapshotCache &&
                now - conversationChromeSnapshotCache.fetchedAtMs < CONVERSATION_CHROME_CACHE_TTL_MS) {
                return conversationChromeSnapshotCache.snapshot;
            }
            if (conversationChromeSnapshotInflight) {
                return conversationChromeSnapshotInflight;
            }
            conversationChromeSnapshotInflight = loadConversationChromeSnapshot(effectiveStateInput)
                .then((snapshot) => {
                conversationChromeSnapshotCache = {
                    snapshot,
                    fetchedAtMs: Date.now(),
                };
                return snapshot;
            })
                .finally(() => {
                conversationChromeSnapshotInflight = null;
            });
            return conversationChromeSnapshotInflight;
        },
        handleConversationChromeAction: async (action) => {
            switch (action.type) {
                case "topbar-task-count-click": {
                    if (typeof host.openTaskDrawer !== "function") {
                        return {
                            ok: false,
                            integration_mode: "codex-native-host",
                            action: action.type,
                            error: "Codex host method openTaskDrawer is unavailable",
                        };
                    }
                    await host.openTaskDrawer();
                    applyConversationChromeEventPatch({ taskDrawerOpen: true });
                    return {
                        ok: true,
                        integration_mode: "codex-native-host",
                        action: action.type,
                        task_drawer_open: true,
                    };
                }
                case "footer-terminal-toggle-click": {
                    if (typeof host.toggleTerminalPanel !== "function") {
                        return {
                            ok: false,
                            integration_mode: "codex-native-host",
                            action: action.type,
                            error: "Codex host method toggleTerminalPanel is unavailable",
                        };
                    }
                    await host.toggleTerminalPanel();
                    const terminalOpen = await loadTerminalOpen();
                    applyConversationChromeEventPatch({ terminalOpen });
                    return {
                        ok: true,
                        integration_mode: "codex-native-host",
                        action: action.type,
                        terminal_open: terminalOpen,
                    };
                }
                case "footer-branch-switch": {
                    const branch = action.branch.trim();
                    if (!branch) {
                        return {
                            ok: false,
                            integration_mode: "codex-native-host",
                            action: action.type,
                            error: "Branch name is required",
                        };
                    }
                    if (typeof host.switchTaskNerveBranch !== "function") {
                        return {
                            ok: false,
                            integration_mode: "codex-native-host",
                            action: action.type,
                            error: "Codex host method switchTaskNerveBranch is unavailable",
                        };
                    }
                    await host.switchTaskNerveBranch(branch);
                    const branches = conversationChromeEventState.branches;
                    applyConversationChromeEventPatch({
                        currentBranch: branch,
                        branches: branches && branches.length > 0
                            ? [branch, ...branches.filter((entry) => entry !== branch)]
                            : undefined,
                    });
                    return {
                        ok: true,
                        integration_mode: "codex-native-host",
                        action: action.type,
                        branch,
                    };
                }
            }
            const exhaustive = action;
            throw new Error(`Unsupported conversation chrome action: ${String(exhaustive)}`);
        },
        observeThreadRefresh: async (observeOptions) => {
            return subscribeWithFallback({
                subscribe: host.subscribeThreadEvents,
                // Thread events can be very chatty; avoid forcing chrome re-reads unless
                // callers explicitly request snapshots after the short TTL window.
                listener: (event) => {
                    observeOptions.onEvent(event);
                },
                subscribeArgs: [{ threadId: observeOptions.threadId ?? null }],
                onFallbackRefresh: observeOptions.onFallbackRefresh,
            });
        },
        observeRepositorySettingsRefresh: async (observeOptions) => {
            return subscribeWithFallback({
                subscribe: host.subscribeRepositorySettingsEvents,
                listener: (event) => {
                    invalidateConversationChromeCache();
                    observeOptions.onEvent(event);
                },
                onFallbackRefresh: observeOptions.onFallbackRefresh
                    ? () => {
                        invalidateConversationChromeCache();
                        observeOptions.onFallbackRefresh?.();
                    }
                    : undefined,
            });
        },
        observeConversationChromeRefresh: async (observeOptions) => {
            const disposers = (await Promise.all([
                subscribeOptional({
                    subscribe: host.subscribeTaskNerveTaskCountEvents,
                    listener: (event) => {
                        const taskCount = parseTaskCountMaybe(event);
                        if (taskCount !== null) {
                            applyConversationChromeEventPatch({ taskCount });
                        }
                        observeOptions.onEvent({ source: "task-count", payload: event });
                    },
                }),
                subscribeOptional({
                    subscribe: host.subscribeTaskDrawerStateEvents,
                    listener: (event) => {
                        const taskDrawerOpen = parseOpenStateMaybe(event);
                        if (taskDrawerOpen !== null) {
                            applyConversationChromeEventPatch({ taskDrawerOpen });
                        }
                        observeOptions.onEvent({ source: "task-drawer", payload: event });
                    },
                }),
                subscribeOptional({
                    subscribe: host.subscribeTerminalPanelStateEvents,
                    listener: (event) => {
                        const terminalOpen = parseOpenStateMaybe(event);
                        if (terminalOpen !== null) {
                            applyConversationChromeEventPatch({ terminalOpen });
                        }
                        observeOptions.onEvent({ source: "terminal-panel", payload: event });
                    },
                }),
                subscribeOptional({
                    subscribe: host.subscribeTaskNerveBranchEvents,
                    listener: (event) => {
                        const branchPatch = parseBranchStatePatch(event);
                        if (branchPatch) {
                            applyConversationChromeEventPatch({
                                currentBranch: branchPatch.currentBranch,
                                branches: branchPatch.branches,
                            });
                        }
                        observeOptions.onEvent({ source: "branch-state", payload: event });
                    },
                }),
                subscribeOptional({
                    subscribe: host.subscribeTaskNerveResourceStatsEvents,
                    listener: (event) => {
                        const resourceStats = parseResourceStatsPatch(event);
                        if (resourceStats) {
                            applyConversationChromeEventPatch({ resourceStats });
                        }
                        observeOptions.onEvent({ source: "resource-stats", payload: event });
                    },
                }),
            ])).filter((disposer) => typeof disposer === "function");
            if (disposers.length === 0) {
                observeOptions.onFallbackRefresh?.();
                return {
                    mode: "fallback-manual-refresh",
                    dispose: () => { },
                };
            }
            return {
                mode: "host-event-subscription",
                dispose: () => {
                    disposers.forEach((disposer) => {
                        disposer();
                    });
                },
            };
        },
    };
}
//# sourceMappingURL=codexTaskNerveHostRuntime.js.map