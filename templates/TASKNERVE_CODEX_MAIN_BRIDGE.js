(() => {
  if (globalThis.__TASKNERVE_CODEX_NATIVE_BRIDGE__) {
    return;
  }
  globalThis.__TASKNERVE_CODEX_NATIVE_BRIDGE__ = true;

  const TASKNERVE_BRIDGE_HOST = "__TASKNERVE_BRIDGE_HOST__";
  const TASKNERVE_BRIDGE_PORT = __TASKNERVE_BRIDGE_PORT__;
  const TASKNERVE_BRIDGE_ORIGIN = `http://${TASKNERVE_BRIDGE_HOST}:${TASKNERVE_BRIDGE_PORT}`;
  const TASKNERVE_LOCAL_HOST_CONFIG = __TASKNERVE_LOCAL_HOST_CONFIG__;
  const TASKNERVE_CONTEXT_RESOLVER = __TASKNERVE_CONTEXT_RESOLVER__;
  const TASKNERVE_ENSURE_WINDOW = __TASKNERVE_ENSURE_WINDOW__;
  const TASKNERVE_NAVIGATE_ROUTE = __TASKNERVE_NAVIGATE_ROUTE__;
  const TASKNERVE_WINDOW_MANAGER = __TASKNERVE_WINDOW_MANAGER__;

  const http = require("node:http");
  const crypto = require("node:crypto");
  const os = require("node:os");
  const { execFile } = require("node:child_process");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const { promisify } = require("node:util");
  const electron = require("electron");
  const execFileAsync = promisify(execFile);

  let tasknerveCpuSample = null;
  let tasknerveResourceCache = {
    captured_at_utc: null,
    cpu_percent: null,
    gpu_percent: null,
    memory_percent: null,
    thermal_pressure: null,
  };
  let tasknerveResourceCachePromise = null;
  let tasknerveDockMenuInitialized = false;

  const TASKNERVE_STANDARD_PROJECT_DOCUMENTS = [
    {
      key: "project_goals",
      file_name: "project_goals.md",
      label: "project_goals.md",
      title: "Project Goals",
    },
    {
      key: "project_manifest",
      file_name: "project_manifest.md",
      label: "project_manifest.md",
      title: "Project Manifest",
    },
    {
      key: "contributing_ideas",
      file_name: "contributing ideas.md",
      label: "contributing ideas.md",
      title: "Contributing Ideas",
    },
  ];
  const TASKNERVE_WORKER_NAME_PREFIXES = [
    "Amber",
    "Arc",
    "Bramble",
    "Cinder",
    "Cloud",
    "Copper",
    "Drift",
    "Ember",
    "Fable",
    "Fern",
    "Glimmer",
    "Harbor",
    "Juniper",
    "Kite",
    "Lumen",
    "Moss",
    "Pebble",
    "Quill",
    "Ripple",
    "Sable",
    "Thistle",
    "Velvet",
    "Willow",
    "Zephyr",
  ];
  const TASKNERVE_WORKER_NAME_SUFFIXES = [
    "Badger",
    "Comet",
    "Falcon",
    "Fox",
    "Gadget",
    "Heron",
    "Lantern",
    "Lark",
    "Maple",
    "Meteor",
    "Otter",
    "Pine",
    "Raven",
    "Rocket",
    "Sparrow",
    "Sprout",
    "Starling",
    "Tinker",
    "Vortex",
    "Wanderer",
    "Whisker",
    "Wisp",
    "Yarrow",
    "Yonder",
  ];

  function tasknerveLog(level, message, extra) {
    try {
      const logger = console[level] || console.log;
      if (extra === undefined) {
        logger(`[tasknerve-codex] ${message}`);
      } else {
        logger(`[tasknerve-codex] ${message}`, extra);
      }
    } catch (_error) {}
  }

  function tasknerveRequiredText(value, field) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error(`${field} is required`);
    }
    return text;
  }

  function tasknerveOptionalText(value) {
    if (typeof value !== "string") {
      return null;
    }
    const text = value.trim();
    return text ? text : null;
  }

  function tasknerveQueryText(url, key) {
    return tasknerveOptionalText(url.searchParams.get(key));
  }

  function tasknerveProjectDisplayName(projectRoot, explicitName) {
    const name = tasknerveOptionalText(explicitName);
    if (name) {
      return name;
    }
    const fallback = path.basename(String(projectRoot || "").trim());
    return fallback || "project";
  }

  function tasknerveHashText(value) {
    let hash = 2166136261;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function tasknerveLooksGenericWorkerLabel(label) {
    const normalized = String(label || "").trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    if (
      normalized === "thread" ||
      normalized === "untitled thread" ||
      normalized === "untitled" ||
      normalized === "new thread"
    ) {
      return true;
    }
    return /^(agent|worker|thread)\b/.test(normalized);
  }

  function tasknerveUsedWorkerLabels(state, excludeThreadId = null) {
    return new Set(
      (Array.isArray(state?.bindings) ? state.bindings : [])
        .filter((binding) => !tasknerveIsControllerAgent(binding?.agent_id))
        .filter((binding) => !excludeThreadId || binding?.thread_id !== excludeThreadId)
        .map((binding) => tasknerveOptionalText(binding?.label))
        .filter(Boolean)
        .map((label) => label.toLowerCase()),
    );
  }

  function tasknerveGenerateWorkerLabel(state, projectName, threadId) {
    const seedBase = `${tasknerveProjectDisplayName("", projectName)}:${threadId || crypto.randomUUID()}`;
    const prefixStart = tasknerveHashText(`${seedBase}:prefix`) % TASKNERVE_WORKER_NAME_PREFIXES.length;
    const suffixStart = tasknerveHashText(`${seedBase}:suffix`) % TASKNERVE_WORKER_NAME_SUFFIXES.length;
    const used = tasknerveUsedWorkerLabels(state, threadId);
    let fallback = null;
    for (let attempt = 0; attempt < TASKNERVE_WORKER_NAME_PREFIXES.length * TASKNERVE_WORKER_NAME_SUFFIXES.length; attempt += 1) {
      const prefix = TASKNERVE_WORKER_NAME_PREFIXES[(prefixStart + attempt) % TASKNERVE_WORKER_NAME_PREFIXES.length];
      const suffix = TASKNERVE_WORKER_NAME_SUFFIXES[(suffixStart + (attempt * 5)) % TASKNERVE_WORKER_NAME_SUFFIXES.length];
      const candidate = `${prefix} ${suffix}`;
      if (!fallback) {
        fallback = candidate;
      }
      if (!used.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
    let suffixNumber = 2;
    while (used.has(`${fallback} ${suffixNumber}`.toLowerCase())) {
      suffixNumber += 1;
    }
    return `${fallback} ${suffixNumber}`;
  }

  function tasknerveResolvedWorkerLabel(state, projectName, threadId, preferredLabel) {
    const normalized = tasknerveOptionalText(preferredLabel);
    if (normalized && !tasknerveLooksGenericWorkerLabel(normalized)) {
      return normalized;
    }
    return tasknerveGenerateWorkerLabel(state, projectName, threadId);
  }

  function tasknerveProjectDocumentDescriptor(docKey) {
    const descriptor = TASKNERVE_STANDARD_PROJECT_DOCUMENTS.find((doc) => doc.key === docKey);
    if (!descriptor) {
      throw new Error(`Unknown project document: ${docKey}`);
    }
    return descriptor;
  }

  function tasknerveProjectDocumentTemplate(docKey, projectName) {
    switch (docKey) {
      case "project_goals":
        return `# Project Goals

Project: ${projectName}

Use this file to lock in what the project is trying to achieve before the controller expands the queue.

## Current Understanding
- Summarize the current state of the project.

## Goals
- Capture the outcomes the project should deliver.

## Non-Goals
- Record what this project is intentionally not trying to do.

## Open Questions
- Track the questions that still need user decisions.

## Locked Decisions
- Move agreed goals here so agents can treat them as durable constraints.
`;
      case "project_manifest":
        return `# Project Manifest

Project: ${projectName}

Use this file to lock in how the project should be built and maintained.

## Languages And Runtime
- Primary languages:
- Runtime targets:

## Libraries And Frameworks
- Required libraries:
- Preferred UI/tooling stack:

## Engineering Patterns
- Architectural style:
- State management:
- Testing expectations:

## Workflow Expectations
- Key commands:
- Review standards:
- Deployment / release notes:
`;
      case "contributing_ideas":
        return `# Contributing Ideas

Project: ${projectName}

Use this file to collect inspiration, reference links, patterns worth borrowing, and ideas the controller should keep in mind.

## Links To Review
- [Title](https://example.com) - Why it matters.

## Concepts To Borrow
- Idea:

## Experiments To Try
- Experiment:

## Notes For The Controller
- Guidance:
`;
      default:
        throw new Error(`Unsupported project document template: ${docKey}`);
    }
  }

  async function tasknerveReadTextFile(filePath) {
    return fs.readFile(filePath, "utf8");
  }

  async function tasknerveReadJsonFile(filePath) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function tasknerveEnsureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async function tasknerveWritePrettyJson(filePath, payload) {
    await tasknerveEnsureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async function tasknerveAppendJsonl(filePath, payloads) {
    const rows = Array.isArray(payloads) ? payloads : [payloads];
    if (rows.length === 0) {
      return;
    }
    await tasknerveEnsureDir(path.dirname(filePath));
    const chunk = rows.map((row) => JSON.stringify(row)).join("\n");
    await fs.appendFile(filePath, `${chunk}\n`, "utf8");
  }

  function tasknerveCodexProjectRoot(projectRoot) {
    const normalizedRoot = path.resolve(tasknerveRequiredText(projectRoot, "project_root"));
    return path.join(normalizedRoot, ".tasknerve", "codex");
  }

  function tasknerveNativeProjectSettingsPath(projectRoot) {
    return path.join(tasknerveCodexProjectRoot(projectRoot), "native_project_settings.json");
  }

  function tasknerveTraceRoot(projectRoot) {
    return path.join(tasknerveCodexProjectRoot(projectRoot), "traces");
  }

  function tasknerveTraceCapturesDir(projectRoot) {
    return path.join(tasknerveTraceRoot(projectRoot), "captures");
  }

  function tasknerveTraceDatasetsDir(projectRoot) {
    return path.join(tasknerveTraceRoot(projectRoot), "datasets");
  }

  function tasknerveTraceStatePath(projectRoot) {
    return path.join(tasknerveTraceRoot(projectRoot), "trace_state.json");
  }

  function tasknerveTraceIndexPath(projectRoot) {
    return path.join(tasknerveTraceRoot(projectRoot), "index.jsonl");
  }

  function tasknerveTraceTurnsPath(projectRoot) {
    return path.join(tasknerveTraceDatasetsDir(projectRoot), "turns.jsonl");
  }

  function tasknerveTraceWorkflowPath(projectRoot) {
    return path.join(tasknerveTraceDatasetsDir(projectRoot), "workflows.jsonl");
  }

  function tasknerveDefaultNativeProjectSettings() {
    return {
      schema_version: "tasknerve.native_project_settings.v1",
      resource_aware_workers: true,
      max_active_workers: 4,
      trace_collection_enabled: false,
      trace_auto_capture_enabled: true,
      trace_capture_interval_seconds: 120,
      trace_last_capture_at_utc: null,
      trace_last_capture_id: null,
    };
  }

  async function tasknerveReadNativeProjectSettings(projectRoot) {
    const settingsPath = tasknerveNativeProjectSettingsPath(projectRoot);
    const stored = (await tasknerveReadJsonFile(settingsPath)) || {};
    const merged = {
      ...tasknerveDefaultNativeProjectSettings(),
      ...(stored && typeof stored === "object" ? stored : {}),
    };
    return {
      settings_path: settingsPath,
      trace_root: tasknerveTraceRoot(projectRoot),
      settings: merged,
    };
  }

  async function tasknerveWriteNativeProjectSettings(projectRoot, partialSettings) {
    const current = await tasknerveReadNativeProjectSettings(projectRoot);
    const merged = {
      ...current.settings,
      ...(partialSettings && typeof partialSettings === "object" ? partialSettings : {}),
      schema_version: "tasknerve.native_project_settings.v1",
    };
    await tasknerveWritePrettyJson(current.settings_path, merged);
    return {
      settings_path: current.settings_path,
      trace_root: current.trace_root,
      settings: merged,
    };
  }

  function tasknerveDefaultTraceState() {
    return {
      schema_version: "tasknerve.trace_state.v1",
      last_capture_id: null,
      last_capture_at_utc: null,
      seen_turn_keys: {},
    };
  }

  async function tasknerveReadTraceState(projectRoot) {
    const filePath = tasknerveTraceStatePath(projectRoot);
    const stored = (await tasknerveReadJsonFile(filePath)) || {};
    return {
      file_path: filePath,
      state: {
        ...tasknerveDefaultTraceState(),
        ...(stored && typeof stored === "object" ? stored : {}),
      },
    };
  }

  function tasknerveTraceCaptureId() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().split("-")[0]
        : Math.random().toString(16).slice(2, 10);
    return `${stamp}-${suffix}`;
  }

  function tasknerveTraceTextParts(value, depth = 0) {
    if (depth > 5 || value == null) {
      return [];
    }
    if (typeof value === "string") {
      const text = value.trim();
      return text ? [text] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => tasknerveTraceTextParts(entry, depth + 1));
    }
    if (typeof value !== "object") {
      return [];
    }
    const preferredKeys = [
      "text",
      "content",
      "message",
      "input",
      "output",
      "parts",
      "items",
      "value",
      "prompt",
      "response",
      "summary",
      "title",
    ];
    const parts = [];
    for (const key of preferredKeys) {
      if (key in value) {
        parts.push(...tasknerveTraceTextParts(value[key], depth + 1));
      }
    }
    if (parts.length > 0) {
      return parts;
    }
    return Object.values(value).flatMap((entry) => tasknerveTraceTextParts(entry, depth + 1));
  }

  function tasknerveTraceTurnTimestamp(turn, fallbackValue) {
    const candidates = [
      turn?.created_at_utc,
      turn?.created_at,
      turn?.createdAt,
      turn?.updated_at_utc,
      turn?.updated_at,
      turn?.updatedAt,
      fallbackValue,
    ];
    for (const candidate of candidates) {
      const text = tasknerveOptionalText(candidate);
      if (text) {
        return text;
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return new Date(candidate).toISOString();
      }
    }
    return null;
  }

  function tasknerveTraceTurnId(turn, threadId, index) {
    const direct =
      tasknerveOptionalText(turn?.turn_id) ||
      tasknerveOptionalText(turn?.turnId) ||
      tasknerveOptionalText(turn?.id) ||
      tasknerveOptionalText(turn?.uuid);
    if (direct) {
      return direct;
    }
    const timestamp = tasknerveTraceTurnTimestamp(turn, null) || `index-${index}`;
    return `${threadId}:turn:${index}:${timestamp}`;
  }

  function tasknerveTraceThreadTurns(thread) {
    if (Array.isArray(thread?.turns)) {
      return thread.turns;
    }
    if (Array.isArray(thread?.messages)) {
      return thread.messages;
    }
    if (Array.isArray(thread?.items)) {
      return thread.items;
    }
    if (Array.isArray(thread?.conversation?.turns)) {
      return thread.conversation.turns;
    }
    if (Array.isArray(thread?.thread?.turns)) {
      return thread.thread.turns;
    }
    return [];
  }

  function tasknerveTraceRoleForThread(threadId, codexSnapshot) {
    const controllerThreadId = codexSnapshot?.controller_binding?.thread_id || null;
    if (controllerThreadId && controllerThreadId === threadId) {
      return "controller";
    }
    const activeWorkerIds = new Set(
      (codexSnapshot?.active_worker_bindings || [])
        .map((entry) => tasknerveOptionalText(entry?.thread_id))
        .filter(Boolean),
    );
    if (activeWorkerIds.has(threadId)) {
      return "worker";
    }
    return "project_thread";
  }

  function tasknerveTraceThreadMetaById(codexSnapshot) {
    const result = new Map();
    const collections = [
      codexSnapshot?.discovered_threads,
      codexSnapshot?.active_worker_bindings,
      codexSnapshot?.bindings,
      codexSnapshot?.inactive_bindings,
    ];
    collections.forEach((entries) => {
      (entries || []).forEach((entry) => {
        const threadId = tasknerveOptionalText(entry?.thread_id);
        if (threadId && !result.has(threadId)) {
          result.set(threadId, entry);
        } else if (threadId) {
          result.set(threadId, { ...result.get(threadId), ...entry });
        }
      });
    });
    const controllerThreadId = tasknerveOptionalText(codexSnapshot?.controller_binding?.thread_id);
    if (controllerThreadId) {
      result.set(controllerThreadId, {
        ...(result.get(controllerThreadId) || {}),
        ...codexSnapshot.controller_binding,
      });
    }
    return result;
  }

  function tasknerveNormalizeTraceThread({ threadId, threadMeta, rawThread, codexSnapshot }) {
    const turns = tasknerveTraceThreadTurns(rawThread);
    const role = tasknerveTraceRoleForThread(threadId, codexSnapshot);
    const label =
      tasknerveOptionalText(threadMeta?.display_label) ||
      tasknerveOptionalText(threadMeta?.thread_name) ||
      tasknerveOptionalText(rawThread?.title) ||
      tasknerveOptionalText(rawThread?.name) ||
      threadId;
    const normalizedTurns = turns.map((turn, index) => {
      const text = tasknerveTraceTextParts(turn).join("\n\n").trim();
      const timestamp = tasknerveTraceTurnTimestamp(
        turn,
        tasknerveOptionalText(threadMeta?.updated_at_utc) || new Date().toISOString(),
      );
      return {
        turn_id: tasknerveTraceTurnId(turn, threadId, index),
        thread_id: threadId,
        thread_role: role,
        thread_label: label,
        index,
        role:
          tasknerveOptionalText(turn?.role) ||
          tasknerveOptionalText(turn?.author) ||
          tasknerveOptionalText(turn?.speaker) ||
          "unknown",
        created_at_utc: timestamp,
        model:
          tasknerveOptionalText(turn?.model) ||
          tasknerveOptionalText(turn?.model_name) ||
          tasknerveOptionalText(turn?.modelName) ||
          null,
        text,
        raw: turn,
      };
    });
    return {
      thread_id: threadId,
      label,
      role,
      updated_at_utc:
        tasknerveOptionalText(threadMeta?.updated_at_utc) ||
        tasknerveOptionalText(rawThread?.updated_at_utc) ||
        null,
      cwd:
        tasknerveOptionalText(threadMeta?.cwd) ||
        tasknerveOptionalText(rawThread?.cwd) ||
        null,
      source:
        tasknerveOptionalText(threadMeta?.source) ||
        tasknerveOptionalText(rawThread?.source) ||
        null,
      turn_count: normalizedTurns.length,
      turns: normalizedTurns,
      raw_thread: rawThread,
      meta: threadMeta || null,
    };
  }

  function tasknerveCpuTimesSnapshot() {
    return os.cpus().reduce(
      (totals, cpu) => {
        const times = cpu?.times || {};
        totals.user += Number(times.user || 0);
        totals.nice += Number(times.nice || 0);
        totals.sys += Number(times.sys || 0);
        totals.idle += Number(times.idle || 0);
        totals.irq += Number(times.irq || 0);
        return totals;
      },
      { user: 0, nice: 0, sys: 0, idle: 0, irq: 0, captured_at_ms: Date.now() },
    );
  }

  function tasknerveCpuPercentBetween(previous, next) {
    if (!previous || !next) {
      return null;
    }
    const idle = Math.max(0, (next.idle || 0) - (previous.idle || 0));
    const total =
      Math.max(0, (next.user || 0) - (previous.user || 0)) +
      Math.max(0, (next.nice || 0) - (previous.nice || 0)) +
      Math.max(0, (next.sys || 0) - (previous.sys || 0)) +
      idle +
      Math.max(0, (next.irq || 0) - (previous.irq || 0));
    if (total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 100)));
  }

  async function tasknerveReadCpuPercent() {
    const initial = tasknerveCpuSample || tasknerveCpuTimesSnapshot();
    if (!tasknerveCpuSample) {
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
    const next = tasknerveCpuTimesSnapshot();
    tasknerveCpuSample = next;
    return tasknerveCpuPercentBetween(initial, next);
  }

  async function tasknerveReadGpuPercent() {
    if (process.platform !== "darwin") {
      return null;
    }
    try {
      const { stdout } = await execFileAsync("/usr/sbin/ioreg", [
        "-r",
        "-d",
        "1",
        "-c",
        "AGXAccelerator",
      ]);
      const match = stdout.match(/"Device Utilization %" = (\d+)/);
      if (!match) {
        return null;
      }
      const value = Number(match[1]);
      return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
    } catch (_error) {
      return null;
    }
  }

  function tasknerveMemoryPercent() {
    const total = Number(os.totalmem() || 0);
    const free = Number(os.freemem() || 0);
    if (!total || total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(((total - free) / total) * 100)));
  }

  async function tasknerveReadThermalPressure() {
    if (process.platform !== "darwin") {
      return null;
    }
    try {
      const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g", "therm"]);
      const text = String(stdout || "").toLowerCase();
      if (text.includes("cpu power status has been recorded")) {
        return "reduced";
      }
      if (text.includes("performance warning level has been recorded")) {
        return "serious";
      }
      if (text.includes("thermal warning level has been recorded")) {
        return "serious";
      }
      return "nominal";
    } catch (_error) {
      return null;
    }
  }

  function tasknerveRecommendedWorkerCap(metrics, maxWorkers) {
    const normalizedMax = Number.isFinite(Number(maxWorkers)) && Number(maxWorkers) > 0
      ? Math.max(1, Math.floor(Number(maxWorkers)))
      : null;
    if (!normalizedMax) {
      return null;
    }
    const cpu = Number(metrics?.cpu_percent ?? -1);
    const gpu = Number(metrics?.gpu_percent ?? -1);
    const memory = Number(metrics?.memory_percent ?? -1);
    const dominantLoad = Math.max(cpu, gpu, memory);
    if (metrics?.thermal_pressure === "serious" || dominantLoad >= 92) {
      return 1;
    }
    if (dominantLoad >= 84) {
      return Math.max(1, Math.floor(normalizedMax * 0.5));
    }
    if (dominantLoad >= 72) {
      return Math.max(1, Math.floor(normalizedMax * 0.75));
    }
    return normalizedMax;
  }

  async function tasknerveSampleSystemResources(forceFresh = false) {
    const capturedAt = tasknerveResourceCache.captured_at_utc
      ? new Date(tasknerveResourceCache.captured_at_utc).getTime()
      : 0;
    if (
      !forceFresh &&
      capturedAt > 0 &&
      Date.now() - capturedAt < 2500 &&
      tasknerveResourceCache.captured_at_utc
    ) {
      return tasknerveResourceCache;
    }
    if (tasknerveResourceCachePromise) {
      return tasknerveResourceCachePromise;
    }
    tasknerveResourceCachePromise = Promise.all([
      tasknerveReadCpuPercent(),
      tasknerveReadGpuPercent(),
      Promise.resolve(tasknerveMemoryPercent()),
      tasknerveReadThermalPressure(),
    ])
      .then(([cpuPercent, gpuPercent, memoryPercent, thermalPressure]) => {
        tasknerveResourceCache = {
          captured_at_utc: new Date().toISOString(),
          cpu_percent: cpuPercent,
          gpu_percent: gpuPercent,
          memory_percent: memoryPercent,
          thermal_pressure: thermalPressure,
        };
        return tasknerveResourceCache;
      })
      .finally(() => {
        tasknerveResourceCachePromise = null;
      });
    return tasknerveResourceCachePromise;
  }

  async function tasknerveStatDocument(filePath) {
    try {
      return await fs.stat(filePath);
    } catch (_error) {
      return null;
    }
  }

  async function tasknerveEnsureProjectDocument(projectRoot, projectName, docKey) {
    const descriptor = tasknerveProjectDocumentDescriptor(docKey);
    const normalizedRoot = path.resolve(tasknerveRequiredText(projectRoot, "project_root"));
    const filePath = path.join(normalizedRoot, descriptor.file_name);
    let content = null;
    try {
      content = await tasknerveReadTextFile(filePath);
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
      content = tasknerveProjectDocumentTemplate(docKey, projectName);
      await fs.writeFile(filePath, content, "utf8");
    }
    const stat = await tasknerveStatDocument(filePath);
    return {
      key: descriptor.key,
      title: descriptor.title,
      label: descriptor.label,
      file_name: descriptor.file_name,
      path: filePath,
      project_root: normalizedRoot,
      updated_at: stat?.mtime?.toISOString?.() ?? null,
      content,
    };
  }

  function tasknerveWriteJson(res, statusCode, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    });
    res.end(body);
  }

  function tasknerveReadJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => {
        chunks.push(chunk);
      });
      req.on("error", reject);
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8").trim();
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function tasknerveResolveLocalContext() {
    let context = null;
    if (
      typeof TASKNERVE_CONTEXT_RESOLVER === "function" &&
      TASKNERVE_LOCAL_HOST_CONFIG
    ) {
      context = TASKNERVE_CONTEXT_RESOLVER(TASKNERVE_LOCAL_HOST_CONFIG);
    }
    if (!context) {
      throw new Error("Codex local host context is unavailable");
    }
    return context;
  }

  function tasknerveResolveLocalConnection() {
    const context = tasknerveResolveLocalContext();
    const registry = context.appServerConnectionRegistry;
    if (!registry || typeof registry.getConnection !== "function") {
      throw new Error("Codex app server connection registry is unavailable");
    }
    return {
      context,
      connection: registry.getConnection(context.hostId),
    };
  }

  function tasknerveCurrentWindowRef() {
    if (
      typeof TASKNERVE_ENSURE_WINDOW !== "function" ||
      !TASKNERVE_LOCAL_HOST_CONFIG ||
      !TASKNERVE_LOCAL_HOST_CONFIG.id
    ) {
      return null;
    }
    return TASKNERVE_ENSURE_WINDOW(TASKNERVE_LOCAL_HOST_CONFIG.id);
  }

  function tasknerveFocusedWindowRef() {
    try {
      return electron?.BrowserWindow?.getFocusedWindow?.() || null;
    } catch (_error) {
      return null;
    }
  }

  function tasknerveNowUtc() {
    return new Date().toISOString();
  }

  function tasknerveTimelineRoot(projectRoot) {
    return path.join(path.resolve(tasknerveRequiredText(projectRoot, "project_root")), ".tasknerve");
  }

  function tasknerveTasksStatePath(projectRoot) {
    return path.join(tasknerveTimelineRoot(projectRoot), "tasks.json");
  }

  function tasknerveBranchesStatePath(projectRoot) {
    return path.join(tasknerveTimelineRoot(projectRoot), "branches.json");
  }

  function tasknerveConfigStatePath(projectRoot) {
    return path.join(tasknerveTimelineRoot(projectRoot), "config.json");
  }

  function tasknerveCodexThreadStatePath(projectRoot) {
    return path.join(tasknerveTimelineRoot(projectRoot), "codex", "threads.json");
  }

  function tasknerveProjectsRegistryPath() {
    return path.join(os.homedir(), ".tasknerve", "projects.json");
  }

  function tasknerveDefaultProjectRegistry() {
    return {
      schema_version: "tasknerve.projects.v1",
      updated_at_utc: tasknerveNowUtc(),
      default_project: null,
      projects: [],
    };
  }

  function tasknerveDefaultTaskState() {
    return {
      schema_version: "tasknerve.tasks.v1",
      updated_at_utc: tasknerveNowUtc(),
      tasks: [],
    };
  }

  function tasknerveDefaultBranchesState() {
    return {
      schema_version: "timeline.branches.v1",
      active_branch: null,
      branches: {},
    };
  }

  function tasknerveDefaultCodexThreadState() {
    return {
      schema_version: "tasknerve.codex.thread_state.v1",
      updated_at_utc: tasknerveNowUtc(),
      bindings: [],
      queued_prompts: [],
    };
  }

  async function tasknerveLoadProjectRegistry() {
    const current = await tasknerveReadJsonFile(tasknerveProjectsRegistryPath());
    const registry =
      current && typeof current === "object" ? { ...tasknerveDefaultProjectRegistry(), ...current } : tasknerveDefaultProjectRegistry();
    registry.projects = Array.isArray(registry.projects) ? registry.projects.slice() : [];
    registry.projects.sort((left, right) =>
      String(left?.name || "").localeCompare(String(right?.name || "")),
    );
    return registry;
  }

  async function tasknerveWriteProjectRegistry(registry) {
    const normalized = {
      ...tasknerveDefaultProjectRegistry(),
      ...(registry && typeof registry === "object" ? registry : {}),
      updated_at_utc: tasknerveNowUtc(),
    };
    normalized.projects = Array.isArray(normalized.projects) ? normalized.projects.slice() : [];
    normalized.projects.sort((left, right) =>
      String(left?.name || "").localeCompare(String(right?.name || "")),
    );
    await tasknerveWritePrettyJson(tasknerveProjectsRegistryPath(), normalized);
    return normalized;
  }

  function tasknerveUniqueProjectName(registry, desiredName, projectRoot) {
    const normalizedDesired = tasknerveRequiredText(desiredName, "project_name");
    const normalizedRoot = path.resolve(tasknerveRequiredText(projectRoot, "project_root"));
    const existing = (registry?.projects || []).find(
      (project) => path.resolve(String(project?.repo_root || "")) === normalizedRoot,
    );
    if (existing?.name) {
      return existing.name;
    }
    const taken = new Set(
      (registry?.projects || [])
        .map((project) => tasknerveOptionalText(project?.name))
        .filter(Boolean)
        .map((name) => name.toLowerCase()),
    );
    if (!taken.has(normalizedDesired.toLowerCase())) {
      return normalizedDesired;
    }
    let index = 2;
    while (taken.has(`${normalizedDesired} ${index}`.toLowerCase())) {
      index += 1;
    }
    return `${normalizedDesired} ${index}`;
  }

  async function tasknerveLoadTaskState(projectRoot) {
    const current = await tasknerveReadJsonFile(tasknerveTasksStatePath(projectRoot));
    const normalized =
      current && typeof current === "object" ? { ...tasknerveDefaultTaskState(), ...current } : tasknerveDefaultTaskState();
    normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks.slice() : [];
    return normalized;
  }

  async function tasknerveWriteTaskState(projectRoot, state) {
    const normalized = {
      ...tasknerveDefaultTaskState(),
      ...(state && typeof state === "object" ? state : {}),
      updated_at_utc: tasknerveNowUtc(),
    };
    normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks.slice() : [];
    await tasknerveWritePrettyJson(tasknerveTasksStatePath(projectRoot), normalized);
    return normalized;
  }

  async function tasknerveLoadBranchesState(projectRoot) {
    const current = await tasknerveReadJsonFile(tasknerveBranchesStatePath(projectRoot));
    const normalized =
      current && typeof current === "object"
        ? { ...tasknerveDefaultBranchesState(), ...current }
        : tasknerveDefaultBranchesState();
    if (!normalized.branches || typeof normalized.branches !== "object") {
      normalized.branches = {};
    }
    return normalized;
  }

  async function tasknerveWriteBranchesState(projectRoot, state) {
    const normalized = {
      ...tasknerveDefaultBranchesState(),
      ...(state && typeof state === "object" ? state : {}),
    };
    if (!normalized.branches || typeof normalized.branches !== "object") {
      normalized.branches = {};
    }
    await tasknerveWritePrettyJson(tasknerveBranchesStatePath(projectRoot), normalized);
    return normalized;
  }

  async function tasknerveLoadCodexThreadState(projectRoot) {
    const current = await tasknerveReadJsonFile(tasknerveCodexThreadStatePath(projectRoot));
    const normalized =
      current && typeof current === "object"
        ? { ...tasknerveDefaultCodexThreadState(), ...current }
        : tasknerveDefaultCodexThreadState();
    normalized.bindings = Array.isArray(normalized.bindings) ? normalized.bindings.slice() : [];
    normalized.queued_prompts = Array.isArray(normalized.queued_prompts)
      ? normalized.queued_prompts.slice()
      : [];
    return normalized;
  }

  async function tasknerveWriteCodexThreadState(projectRoot, state) {
    const normalized = {
      ...tasknerveDefaultCodexThreadState(),
      ...(state && typeof state === "object" ? state : {}),
      updated_at_utc: tasknerveNowUtc(),
    };
    normalized.bindings = Array.isArray(normalized.bindings) ? normalized.bindings.slice() : [];
    normalized.queued_prompts = Array.isArray(normalized.queued_prompts)
      ? normalized.queued_prompts.slice()
      : [];
    await tasknerveWritePrettyJson(tasknerveCodexThreadStatePath(projectRoot), normalized);
    return normalized;
  }

  function tasknerveDefaultProjectCodexSettings() {
    return {
      schema_version: "tasknerve.project_codex_settings.v1",
      updated_at_utc: tasknerveNowUtc(),
      heartbeat_message_core:
        "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!",
      low_queue_controller_prompt:
        "The TaskNerve queue for {project_name} is running low. Review the current repository state, `project_goals.md`, `project_manifest.md`, and the existing TaskNerve backlog. Add the next best development and maintenance tasks, consolidate stale work, and keep the active workers fed with concrete, high-leverage tasks.",
      low_queue_controller_enabled: true,
      worker_single_message_mode: true,
      worker_model_routing_enabled: false,
      worker_default_model: null,
      controller_default_model: null,
      low_intelligence_model: null,
      medium_intelligence_model: null,
      high_intelligence_model: null,
      max_intelligence_model: null,
      git_origin_url: null,
      git_sync_policy: "every_task",
      git_sync_every_n_tasks: 1,
    };
  }

  async function tasknerveLoadProjectCodexSettings(projectRoot) {
    const current = await tasknerveReadJsonFile(
      path.join(tasknerveTimelineRoot(projectRoot), "codex", "project_settings.json"),
    );
    const normalized =
      current && typeof current === "object"
        ? { ...tasknerveDefaultProjectCodexSettings(), ...current }
        : tasknerveDefaultProjectCodexSettings();
    normalized.updated_at_utc = normalized.updated_at_utc || tasknerveNowUtc();
    return normalized;
  }

  async function tasknerveWriteProjectCodexSettings(projectRoot, partialSettings) {
    const current = await tasknerveLoadProjectCodexSettings(projectRoot);
    const normalized = {
      ...current,
      ...(partialSettings && typeof partialSettings === "object" ? partialSettings : {}),
      updated_at_utc: tasknerveNowUtc(),
      schema_version: "tasknerve.project_codex_settings.v1",
    };
    await tasknerveWritePrettyJson(
      path.join(tasknerveTimelineRoot(projectRoot), "codex", "project_settings.json"),
      normalized,
    );
    return normalized;
  }

  function tasknerveNormalizeProjectEntry(project) {
    return {
      key: String(project?.name || ""),
      name: String(project?.name || ""),
      repo_root: String(project?.repo_root || ""),
      is_default: false,
      is_current_repo: false,
      is_most_recent: false,
      last_activity_at_utc: project?.last_activity_at_utc || null,
      last_opened_at_utc: project?.last_opened_at_utc || null,
    };
  }

  async function tasknerveResolveProjectSelection(projectSelector) {
    const registry = await tasknerveLoadProjectRegistry();
    const projects = registry.projects.map(tasknerveNormalizeProjectEntry);
    const token = tasknerveOptionalText(projectSelector);
    let selected =
      (token &&
        projects.find((project) => project.key === token || project.name === token || project.repo_root === token)) ||
      null;
    if (!selected && registry.default_project) {
      selected = projects.find((project) => project.key === registry.default_project) || null;
    }
    if (!selected) {
      selected = projects[0] || null;
    }
    if (!selected) {
      throw new Error("TaskNerve project registry is empty");
    }
    selected.is_default = registry.default_project === selected.key;
    return {
      registry,
      projects,
      selected,
      repoRoot: selected.repo_root,
    };
  }

  function tasknerveDetectGitBranch(projectRoot) {
    const headPath = path.join(path.resolve(projectRoot), ".git", "HEAD");
    try {
      const raw = require("node:fs").readFileSync(headPath, "utf8").trim();
      const match = raw.match(/^ref:\s+refs\/heads\/(.+)$/);
      return match ? match[1] : raw || null;
    } catch (_error) {
      return null;
    }
  }

  function tasknerveControllerAgentId() {
    return "agent.controller";
  }

  function tasknerveIsControllerAgent(agentId) {
    return String(agentId || "") === tasknerveControllerAgentId();
  }

  function tasknerveThreadIdShort(threadId) {
    const normalized = String(threadId || "").trim();
    return normalized ? normalized.slice(0, 8) : "";
  }

  function tasknerveExtractTaggedValue(task, prefix) {
    const tag = (Array.isArray(task?.tags) ? task.tags : []).find((entry) =>
      String(entry || "").startsWith(`${prefix}:`),
    );
    if (!tag) {
      return null;
    }
    const value = String(tag).slice(prefix.length + 1).trim();
    return value || null;
  }

  function tasknerveTaskBlockedBy(task, tasksById) {
    const blocked = [];
    const dependsOn = Array.isArray(task?.depends_on) ? task.depends_on : [];
    dependsOn.forEach((taskId) => {
      const dependency = tasksById.get(taskId);
      if (!dependency || dependency.status !== "done") {
        blocked.push(`depends_on:${taskId}`);
      }
    });
    if (task?.awaiting_confirmation) {
      blocked.push("confirmation");
    }
    if (task?.blocked_reason) {
      blocked.push(`blocked:${task.blocked_reason}`);
    }
    return blocked;
  }

  function tasknerveTaskReady(task, tasksById) {
    return String(task?.status || "open") === "open" && tasknerveTaskBlockedBy(task, tasksById).length === 0;
  }

  function tasknerveSortTaskPayloads(tasks) {
    const statusRank = {
      open: 0,
      claimed: 1,
      blocked: 2,
      done: 3,
    };
    return tasks.slice().sort((left, right) => {
      const leftRank = statusRank[left.status] ?? 9;
      const rightRank = statusRank[right.status] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
  }

  function tasknerveTaskPayload(task, tasksById) {
    const blockedBy = tasknerveTaskBlockedBy(task, tasksById);
    return {
      ...task,
      suggested_intelligence:
        task?.suggested_intelligence || tasknerveExtractTaggedValue(task, "intelligence"),
      suggested_model: task?.suggested_model || tasknerveExtractTaggedValue(task, "model"),
      blocked_by: blockedBy,
      ready: tasknerveTaskReady(task, tasksById),
    };
  }

  function tasknerveNextWorkerAgentId(state, threadId) {
    const base = `agent.codex.${tasknerveThreadIdShort(threadId).toLowerCase() || crypto.randomUUID().slice(0, 8)}`;
    if (!state.bindings.some((binding) => binding.agent_id === base)) {
      return base;
    }
    let index = 2;
    while (state.bindings.some((binding) => binding.agent_id === `${base}.${index}`)) {
      index += 1;
    }
    return `${base}.${index}`;
  }

  function tasknerveBindingDisplayLabel(binding) {
    return (
      tasknerveOptionalText(binding?.label) ||
      tasknerveOptionalText(binding?.thread_name) ||
      tasknerveThreadIdShort(binding?.thread_id) ||
      tasknerveOptionalText(binding?.thread_id) ||
      "Thread"
    );
  }

  function tasknerveCodexSnapshotPayload(state) {
    const bindings = (Array.isArray(state?.bindings) ? state.bindings : []).map((binding) => ({
      ...binding,
      role: tasknerveIsControllerAgent(binding?.agent_id) ? "controller" : "worker",
      thread_id_short: tasknerveThreadIdShort(binding?.thread_id),
      display_label: tasknerveBindingDisplayLabel(binding),
      active: true,
      queued_pending_count: (state?.queued_prompts || []).filter(
        (prompt) => prompt?.agent_id === binding?.agent_id && prompt?.status === "pending",
      ).length,
      queued_running_count: (state?.queued_prompts || []).filter(
        (prompt) => prompt?.agent_id === binding?.agent_id && prompt?.status === "running",
      ).length,
      discovered_thread: null,
      worker: null,
    }));
    const discoveredThreads = bindings
      .map((binding) => ({
        thread_id: binding.thread_id,
        thread_id_short: binding.thread_id_short,
        display_label: binding.display_label,
        thread_name: binding.label || binding.display_label,
        updated_at_utc: binding.updated_at_utc || binding.created_at_utc || null,
        updated_at_unix_seconds: binding.updated_at_utc
          ? Math.floor(new Date(binding.updated_at_utc).getTime() / 1000)
          : 0,
      }))
      .sort((left, right) => Number(right.updated_at_unix_seconds || 0) - Number(left.updated_at_unix_seconds || 0));
    const controllerBinding =
      bindings.find((binding) => binding.agent_id === tasknerveControllerAgentId()) || null;
    const activeWorkerBindings = bindings.filter((binding) => binding.role === "worker");
    const queuedPrompts = (Array.isArray(state?.queued_prompts) ? state.queued_prompts : [])
      .slice(-40)
      .map((prompt) => ({
        ...prompt,
        thread_id_short: tasknerveThreadIdShort(prompt?.thread_id),
      }));
    return {
      schema_version: "tasknerve.codex.thread_snapshot.v1",
      generated_at_utc: tasknerveNowUtc(),
      controller_agent_id: tasknerveControllerAgentId(),
      controller_binding: controllerBinding,
      active_thread_count: discoveredThreads.length,
      active_worker_count: activeWorkerBindings.length,
      discovered_threads: discoveredThreads,
      bindings,
      active_worker_bindings: activeWorkerBindings,
      inactive_bindings: [],
      queued_prompts: queuedPrompts,
    };
  }

  async function tasknerveSnapshotPayload(projectSelector) {
    const { projects, selected, repoRoot } = await tasknerveResolveProjectSelection(projectSelector);
    const [taskState, branchState, codexState, projectCodexSettings] = await Promise.all([
      tasknerveLoadTaskState(repoRoot),
      tasknerveLoadBranchesState(repoRoot),
      tasknerveLoadCodexThreadState(repoRoot),
      tasknerveLoadProjectCodexSettings(repoRoot),
    ]);
    await Promise.all(
      TASKNERVE_STANDARD_PROJECT_DOCUMENTS.map((doc) =>
        tasknerveEnsureProjectDocument(repoRoot, selected.name, doc.key),
      ),
    );
    const tasksById = new Map();
    const tasks = Array.isArray(taskState.tasks) ? taskState.tasks.slice() : [];
    tasks.forEach((task) => {
      tasksById.set(task.task_id, task);
    });
    const renderedTasks = tasknerveSortTaskPayloads(
      tasks.map((task) => tasknerveTaskPayload(task, tasksById)),
    );
    return {
      schema_version: "tasknerve.task.gui.snapshot.v1",
      generated_at_utc: tasknerveNowUtc(),
      selected_project: {
        key: selected.key,
        name: selected.name,
        repo_root: selected.repo_root,
      },
      projects,
      timeline_initialized: Boolean(branchState.active_branch),
      timeline: {
        timeline_initialized: Boolean(branchState.active_branch),
        active_branch: branchState.active_branch || null,
        branches: Object.keys(branchState.branches || {}).sort(),
        git_branch_hint: tasknerveDetectGitBranch(repoRoot),
      },
      policy: {
        pending_confirmation_count: renderedTasks.filter((task) => task.awaiting_confirmation).length,
      },
      project_codex_settings: projectCodexSettings,
      count: renderedTasks.length,
      tasks: renderedTasks,
      codex: tasknerveCodexSnapshotPayload(codexState),
    };
  }

  async function tasknerveProjectForThread(threadId) {
    const registry = await tasknerveLoadProjectRegistry();
    for (const project of registry.projects) {
      const state = await tasknerveLoadCodexThreadState(project.repo_root).catch(() => null);
      if ((state?.bindings || []).some((binding) => binding?.thread_id === threadId)) {
        return {
          ok: true,
          selected_project: {
            key: project.name,
            name: project.name,
            repo_root: project.repo_root,
          },
        };
      }
    }
    return {
      ok: true,
      selected_project: null,
    };
  }

  async function tasknerveWriteTaskMutation(projectSelector, mutate) {
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const taskState = await tasknerveLoadTaskState(selection.repoRoot);
    const result = await mutate(taskState, selection);
    await tasknerveWriteTaskState(selection.repoRoot, taskState);
    return result;
  }

  function tasknerveThreadIdFromRoutePath(routePath) {
    const match = String(routePath || "").match(/^\/local\/([^/?#]+)/);
    if (!match) {
      return null;
    }
    try {
      return decodeURIComponent(match[1]);
    } catch (_error) {
      return match[1];
    }
  }

  function tasknerveWindowRouteSnapshot(windowRef) {
    if (
      !windowRef ||
      typeof windowRef.isDestroyed === "function" && windowRef.isDestroyed() ||
      !windowRef.webContents ||
      typeof windowRef.webContents.getURL !== "function"
    ) {
      return null;
    }
    try {
      const windowUrl = windowRef.webContents.getURL() || "";
      if (!windowUrl) {
        return null;
      }
      const parsedUrl = new URL(windowUrl);
      const routePath = `${parsedUrl.pathname}${parsedUrl.search || ""}`;
      return {
        window_url: windowUrl,
        route_path: routePath,
        thread_id: tasknerveThreadIdFromRoutePath(parsedUrl.pathname),
        project_key: tasknerveOptionalText(parsedUrl.searchParams.get("tasknerveProject")),
      };
    } catch (_error) {
      return null;
    }
  }

  async function tasknerveProjectWindowBodyFromWindow(windowRef) {
    const snapshot = tasknerveWindowRouteSnapshot(windowRef);
    if (!snapshot) {
      return null;
    }
    let projectKey = snapshot.project_key;
    if (!projectKey && snapshot.thread_id) {
      try {
        const selection = await tasknerveProjectForThread(snapshot.thread_id);
        projectKey = selection?.selected_project?.key || null;
      } catch (_error) {
        projectKey = null;
      }
    }
    const body = {};
    if (snapshot.route_path) {
      body.route_path = snapshot.route_path;
    }
    if (snapshot.thread_id) {
      body.thread_id = snapshot.thread_id;
    }
    if (projectKey) {
      body.project_key = projectKey;
      body.project_name = projectKey;
    }
    return Object.keys(body).length > 0 ? body : null;
  }

  async function tasknerveDefaultProjectWindowBody() {
    const candidates = [];
    const focusedWindow = tasknerveFocusedWindowRef();
    if (focusedWindow) {
      candidates.push(focusedWindow);
    }
    const currentWindow = await Promise.resolve(tasknerveCurrentWindowRef()).catch(() => null);
    if (currentWindow && !candidates.includes(currentWindow)) {
      candidates.push(currentWindow);
    }
    for (const windowRef of candidates) {
      const body = await tasknerveProjectWindowBodyFromWindow(windowRef).catch(() => null);
      if (body) {
        return body;
      }
    }
    const registry = await tasknerveLoadProjectRegistry().catch(() => null);
    const projects = Array.isArray(registry?.projects) ? registry.projects.map(tasknerveNormalizeProjectEntry) : [];
    let selected = null;
    if (registry?.default_project) {
      selected = projects.find((project) => project.key === registry.default_project) || null;
    }
    if (!selected) {
      selected = projects[0] || null;
    }
    if (!selected) {
      return {
        route_path: "/",
      };
    }
    return {
      route_path: `/?tasknerveProject=${encodeURIComponent(selected.key)}`,
      project_key: selected.key,
      project_name: selected.name,
    };
  }

  async function tasknerveHandleHealth() {
    return {
      ok: true,
      host_id: TASKNERVE_LOCAL_HOST_CONFIG?.id ?? null,
      bridge_origin: TASKNERVE_BRIDGE_ORIGIN,
      transport: "codex_native",
      capabilities: [
        "start_turn",
        "start_thread",
        "set_thread_name",
        "update_thread_title",
        "open_thread",
        "open_project_window",
        "host_context",
        "project_documents",
        "project_native_settings",
        "project_trace_capture",
        "system_resources",
      ],
    };
  }

  async function tasknerveHandleHostContext() {
    const context = tasknerveResolveLocalContext();
    const windowRef = await Promise.resolve(tasknerveCurrentWindowRef()).catch(() => null);
    let windowUrl = null;
    let routePath = null;
    if (
      windowRef &&
      windowRef.webContents &&
      typeof windowRef.webContents.getURL === "function"
    ) {
      try {
        windowUrl = windowRef.webContents.getURL() || null;
        routePath = windowUrl ? new URL(windowUrl).pathname : null;
      } catch (_error) {
        windowUrl = null;
        routePath = null;
      }
    }
    return {
      ok: true,
      host_id: context.hostId,
      host_kind: TASKNERVE_LOCAL_HOST_CONFIG?.kind ?? null,
      host_display_name: TASKNERVE_LOCAL_HOST_CONFIG?.display_name ?? null,
      active_thread_id: tasknerveThreadIdFromRoutePath(routePath),
      route_path: routePath,
      route_search: windowUrl ? new URL(windowUrl).search || "" : "",
      window_url: windowUrl,
      transport: "codex_native",
    };
  }

  async function tasknerveHandleStartTurn(body) {
    const { connection } = tasknerveResolveLocalConnection();
    const threadId = tasknerveRequiredText(body.thread_id ?? body.threadId, "thread_id");
    const prompt = tasknerveRequiredText(body.prompt, "prompt");
    const cwd = tasknerveOptionalText(body.cwd);
    const model = tasknerveOptionalText(body.model);
    const effort = tasknerveOptionalText(body.effort);
    const summary = tasknerveOptionalText(body.summary) || "tasknerve";
    const result = await connection.startTurn({
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: cwd || null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: model || null,
      effort: effort || null,
      serviceTier: body.service_tier ?? body.serviceTier ?? null,
      summary,
      personality: null,
      outputSchema: body.output_schema ?? body.outputSchema ?? null,
      collaborationMode: body.collaboration_mode ?? body.collaborationMode ?? null,
      attachments: [],
    });
    return {
      ok: true,
      thread_id: threadId,
      turn_id: result?.turn?.id ?? null,
      status: result?.turn?.status ?? "queued",
      summary,
    };
  }

  async function tasknerveHandleStartThread(body) {
    const { connection } = tasknerveResolveLocalConnection();
    const cwd = tasknerveRequiredText(body.cwd, "cwd");
    const model = tasknerveOptionalText(body.model);
    const sandbox = tasknerveOptionalText(body.sandbox) || "read-only";
    const approvalPolicy =
      tasknerveOptionalText(body.approval_policy ?? body.approvalPolicy) || "never";
    const developerInstructions = tasknerveOptionalText(
      body.developer_instructions ?? body.developerInstructions,
    );
    const result = await connection.startThread({
      model: model || null,
      modelProvider: null,
      cwd,
      approvalPolicy,
      sandbox,
      config: null,
      baseInstructions: null,
      developerInstructions,
      personality: null,
      ephemeral: null,
      dynamicTools: null,
      mockExperimentalField: null,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      serviceTier: body.service_tier ?? body.serviceTier ?? null,
    });
    return {
      ok: true,
      thread_id: result?.thread?.id ?? null,
      cwd: result?.cwd ?? cwd,
    };
  }

  async function tasknerveHandleSetThreadName(body) {
    const { connection } = tasknerveResolveLocalConnection();
    const threadId = tasknerveRequiredText(body.thread_id ?? body.threadId, "thread_id");
    const title = tasknerveRequiredText(body.title, "title");
    await connection.setThreadName(threadId, title);
    return {
      ok: true,
      thread_id: threadId,
      title,
    };
  }

  async function tasknerveHandleUpdateThreadTitle(body) {
    const { connection } = tasknerveResolveLocalConnection();
    if (typeof connection.updateThreadTitle !== "function") {
      throw new Error("Codex connection does not expose updateThreadTitle");
    }
    const threadId = tasknerveRequiredText(body.thread_id ?? body.threadId, "thread_id");
    const title = tasknerveRequiredText(body.title, "title");
    await connection.updateThreadTitle(threadId, title);
    return {
      ok: true,
      thread_id: threadId,
      title,
    };
  }

  async function tasknerveHandleReadThread(body) {
    const { connection } = tasknerveResolveLocalConnection();
    if (typeof connection.readThread !== "function") {
      throw new Error("Codex connection does not expose readThread");
    }
    const includeTurns = body?.include_turns ?? body?.includeTurns ?? true;
    let threadId = tasknerveOptionalText(body?.thread_id ?? body?.threadId);
    if (!threadId) {
      const hostContext = await tasknerveHandleHostContext();
      threadId = tasknerveOptionalText(hostContext?.active_thread_id);
    }
    if (!threadId) {
      throw new Error("thread_id is required");
    }
    const thread = await connection.readThread(threadId, {
      includeTurns: Boolean(includeTurns),
    });
    return {
      ok: true,
      thread_id: threadId,
      transport: "codex_native",
      thread,
    };
  }

  async function tasknerveHandleEnsureProjectDocuments(body) {
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const documents = await Promise.all(
      TASKNERVE_STANDARD_PROJECT_DOCUMENTS.map((doc) =>
        tasknerveEnsureProjectDocument(projectRoot, projectName, doc.key),
      ),
    );
    return {
      ok: true,
      project_root: path.resolve(projectRoot),
      project_name: projectName,
      documents: documents.map(({ content, ...document }) => document),
    };
  }

  async function tasknerveHandleReadProjectDocument(body) {
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const docKey = tasknerveRequiredText(body.doc_key ?? body.docKey, "doc_key");
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const document = await tasknerveEnsureProjectDocument(projectRoot, projectName, docKey);
    return {
      ok: true,
      document,
    };
  }

  async function tasknerveHandleWriteProjectDocument(body) {
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const docKey = tasknerveRequiredText(body.doc_key ?? body.docKey, "doc_key");
    const content = typeof body.content === "string" ? body.content : "";
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const descriptor = tasknerveProjectDocumentDescriptor(docKey);
    const normalizedRoot = path.resolve(projectRoot);
    const filePath = path.join(normalizedRoot, descriptor.file_name);
    await fs.writeFile(filePath, content, "utf8");
    const stat = await tasknerveStatDocument(filePath);
    return {
      ok: true,
      document: {
        key: descriptor.key,
        title: descriptor.title,
        label: descriptor.label,
        file_name: descriptor.file_name,
        path: filePath,
        project_root: normalizedRoot,
        project_name: projectName,
        updated_at: stat?.mtime?.toISOString?.() ?? null,
        content,
      },
    };
  }

  async function tasknerveHandleOpenProjectInVsCode(body) {
    const projectRoot = path.resolve(
      tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root"),
    );
    const projectName = tasknerveProjectDisplayName(
      projectRoot,
      body.project_name ?? body.projectName,
    );
    const stat = await fs.stat(projectRoot);
    if (!stat.isDirectory()) {
      throw new Error("project_root must be a directory");
    }
    const attempts =
      process.platform === "darwin"
        ? [
            ["open", ["-b", "com.microsoft.VSCode", projectRoot]],
            ["open", ["-a", "Visual Studio Code", projectRoot]],
            ["open", ["-a", "Code", projectRoot]],
            ["code", [projectRoot]],
          ]
        : [
            ["code", [projectRoot]],
            ["code-insiders", [projectRoot]],
            ["codium", [projectRoot]],
          ];
    let lastError = null;
    for (const [command, args] of attempts) {
      try {
        await execFileAsync(command, args, { timeout: 12000 });
        return {
          ok: true,
          app: "vscode",
          project_root: projectRoot,
          project_name: projectName,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to launch Visual Studio Code");
  }

  async function tasknerveHandleRegisterProject(body) {
    const importExisting = Boolean(body.import_existing ?? body.importExisting);
    const requestedRoot = path.resolve(
      tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root"),
    );
    const requestedName = tasknerveOptionalText(body.project_name ?? body.projectName) || path.basename(requestedRoot);
    if (importExisting) {
      const stat = await fs.stat(requestedRoot);
      if (!stat.isDirectory()) {
        throw new Error("project_root must be an existing directory");
      }
    } else {
      await fs.mkdir(requestedRoot, { recursive: true });
    }
    const registry = await tasknerveLoadProjectRegistry();
    const projectName = tasknerveUniqueProjectName(registry, requestedName, requestedRoot);
    const now = tasknerveNowUtc();
    const existingIndex = registry.projects.findIndex(
      (project) => path.resolve(String(project?.repo_root || "")) === requestedRoot,
    );
    const entry = {
      name: projectName,
      repo_root: requestedRoot,
      last_activity_at_utc: now,
      last_opened_at_utc: now,
    };
    if (existingIndex >= 0) {
      registry.projects.splice(existingIndex, 1, {
        ...registry.projects[existingIndex],
        ...entry,
      });
    } else {
      registry.projects.push(entry);
    }
    registry.default_project = projectName;
    await tasknerveWriteProjectRegistry(registry);
    const branchesState = await tasknerveLoadBranchesState(requestedRoot);
    if (!branchesState.active_branch) {
      branchesState.active_branch = "trunk";
    }
    if (!branchesState.branches || typeof branchesState.branches !== "object") {
      branchesState.branches = {};
    }
    if (!branchesState.branches[branchesState.active_branch]) {
      branchesState.branches[branchesState.active_branch] = {
        name: branchesState.active_branch,
        head_event_id: null,
        created_at_utc: now,
        from_branch: null,
        from_event_id: null,
      };
    }
    await Promise.all([
      tasknerveWriteBranchesState(requestedRoot, branchesState),
      tasknerveLoadTaskState(requestedRoot).then((state) => tasknerveWriteTaskState(requestedRoot, state)),
      tasknerveLoadCodexThreadState(requestedRoot).then((state) => tasknerveWriteCodexThreadState(requestedRoot, state)),
      tasknerveLoadProjectCodexSettings(requestedRoot).then((state) => tasknerveWriteProjectCodexSettings(requestedRoot, state)),
      tasknerveReadNativeProjectSettings(requestedRoot).then((payload) =>
        tasknerveWriteNativeProjectSettings(requestedRoot, payload.settings),
      ),
      Promise.all(
        TASKNERVE_STANDARD_PROJECT_DOCUMENTS.map((doc) =>
          tasknerveEnsureProjectDocument(requestedRoot, projectName, doc.key),
        ),
      ),
    ]);
    return {
      ok: true,
      action: importExisting ? "project_import" : "project_create",
      selected_project: {
        key: projectName,
        name: projectName,
        repo_root: requestedRoot,
      },
      project: {
        key: projectName,
        name: projectName,
        repo_root: requestedRoot,
      },
    };
  }

  async function tasknerveHandleReadProjectNativeSettings(body) {
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const payload = await tasknerveReadNativeProjectSettings(projectRoot);
    return {
      ok: true,
      project_root: path.resolve(projectRoot),
      project_name: projectName,
      settings_path: payload.settings_path,
      trace_root: payload.trace_root,
      settings: payload.settings,
    };
  }

  async function tasknerveHandleWriteProjectNativeSettings(body) {
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const settings = body.settings && typeof body.settings === "object" ? body.settings : {};
    const payload = await tasknerveWriteNativeProjectSettings(projectRoot, settings);
    return {
      ok: true,
      project_root: path.resolve(projectRoot),
      project_name: projectName,
      settings_path: payload.settings_path,
      trace_root: payload.trace_root,
      settings: payload.settings,
    };
  }

  async function tasknerveHandleCaptureProjectTrace(body) {
    const { connection } = tasknerveResolveLocalConnection();
    if (typeof connection.readThread !== "function") {
      throw new Error("Codex connection does not expose readThread");
    }
    const projectRoot = tasknerveRequiredText(body.project_root ?? body.projectRoot, "project_root");
    const projectName = tasknerveProjectDisplayName(projectRoot, body.project_name ?? body.projectName);
    const normalizedRoot = path.resolve(projectRoot);
    const reason = tasknerveOptionalText(body.reason) || "manual";
    const codexSnapshot = body.codex_snapshot && typeof body.codex_snapshot === "object"
      ? body.codex_snapshot
      : {};
    const taskSnapshot = Array.isArray(body.tasks) ? body.tasks : [];
    const timeline = body.timeline && typeof body.timeline === "object" ? body.timeline : {};
    const projectCodexSettings =
      body.project_codex_settings && typeof body.project_codex_settings === "object"
        ? body.project_codex_settings
        : {};
    const nativeSettingsPayload =
      body.native_project_settings && typeof body.native_project_settings === "object"
        ? body.native_project_settings
        : {};
    const captureId = tasknerveTraceCaptureId();
    const capturedAtUtc = new Date().toISOString();
    const threadMetaById = tasknerveTraceThreadMetaById(codexSnapshot);
    const threadIds = Array.from(threadMetaById.keys());
    const documents = await Promise.all(
      TASKNERVE_STANDARD_PROJECT_DOCUMENTS.map((doc) =>
        tasknerveEnsureProjectDocument(normalizedRoot, projectName, doc.key),
      ),
    );
    const threads = [];
    const threadErrors = [];
    for (const threadId of threadIds) {
      try {
        const thread = await connection.readThread(threadId, { includeTurns: true });
        threads.push(
          tasknerveNormalizeTraceThread({
            threadId,
            threadMeta: threadMetaById.get(threadId) || null,
            rawThread: thread,
            codexSnapshot,
          }),
        );
      } catch (error) {
        threadErrors.push({
          thread_id: threadId,
          error: error && error.message ? error.message : String(error),
        });
      }
    }
    const traceStatePayload = await tasknerveReadTraceState(normalizedRoot);
    const traceState = traceStatePayload.state;
    const seenTurnKeys =
      traceState.seen_turn_keys && typeof traceState.seen_turn_keys === "object"
        ? traceState.seen_turn_keys
        : {};
    const newTurnRows = [];
    const capturedThreads = threads.map((thread) => {
      const newTurns = [];
      const known = new Set(Array.isArray(seenTurnKeys[thread.thread_id]) ? seenTurnKeys[thread.thread_id] : []);
      thread.turns.forEach((turn) => {
        if (!known.has(turn.turn_id)) {
          known.add(turn.turn_id);
          newTurns.push(turn);
          newTurnRows.push({
            schema_version: "tasknerve.trace_turn.v1",
            capture_id: captureId,
            captured_at_utc: capturedAtUtc,
            project_root: normalizedRoot,
            project_name: projectName,
            timeline_branch: tasknerveOptionalText(timeline?.active_branch) || null,
            thread_id: thread.thread_id,
            thread_label: thread.label,
            thread_role: thread.role,
            turn_id: turn.turn_id,
            turn_index: turn.index,
            role: turn.role,
            created_at_utc: turn.created_at_utc,
            model: turn.model,
            text: turn.text,
          });
        }
      });
      seenTurnKeys[thread.thread_id] = Array.from(known);
      return {
        ...thread,
        new_turn_count: newTurns.length,
        new_turns: newTurns,
      };
    });
    const captureRecord = {
      schema_version: "tasknerve.trace_capture.v1",
      capture_id: captureId,
      captured_at_utc: capturedAtUtc,
      project: {
        name: projectName,
        root: normalizedRoot,
      },
      reason,
      timeline,
      tasks: taskSnapshot,
      task_counts: {
        total: taskSnapshot.length,
        open: taskSnapshot.filter((task) => task?.status === "open").length,
        claimed: taskSnapshot.filter((task) => task?.status === "claimed").length,
        done: taskSnapshot.filter((task) => task?.status === "done").length,
      },
      project_codex_settings: projectCodexSettings,
      native_project_settings: nativeSettingsPayload,
      documents: documents.map((document) => ({
        key: document.key,
        title: document.title,
        label: document.label,
        path: document.path,
        updated_at: document.updated_at,
        content: document.content,
      })),
      codex_snapshot: codexSnapshot,
      threads: capturedThreads,
      thread_errors: threadErrors,
      summary: {
        thread_count: capturedThreads.length,
        new_turn_count: newTurnRows.length,
      },
    };
    const captureFilePath = path.join(tasknerveTraceCapturesDir(normalizedRoot), `${captureId}.json`);
    await tasknerveWritePrettyJson(captureFilePath, captureRecord);
    await tasknerveAppendJsonl(tasknerveTraceIndexPath(normalizedRoot), {
      schema_version: "tasknerve.trace_capture_index.v1",
      capture_id: captureId,
      captured_at_utc: capturedAtUtc,
      reason,
      project_root: normalizedRoot,
      project_name: projectName,
      timeline_branch: tasknerveOptionalText(timeline?.active_branch) || null,
      capture_file: captureFilePath,
      thread_count: capturedThreads.length,
      new_turn_count: newTurnRows.length,
      task_count: taskSnapshot.length,
    });
    await tasknerveAppendJsonl(tasknerveTraceWorkflowPath(normalizedRoot), {
      schema_version: "tasknerve.trace_workflow.v1",
      capture_id: captureId,
      captured_at_utc: capturedAtUtc,
      project_root: normalizedRoot,
      project_name: projectName,
      reason,
      timeline,
      task_counts: captureRecord.task_counts,
      controller_thread_id: codexSnapshot?.controller_binding?.thread_id || null,
      worker_thread_ids: (codexSnapshot?.active_worker_bindings || [])
        .map((entry) => tasknerveOptionalText(entry?.thread_id))
        .filter(Boolean),
      queued_prompt_count: Array.isArray(codexSnapshot?.queued_prompts)
        ? codexSnapshot.queued_prompts.length
        : 0,
      thread_count: capturedThreads.length,
      new_turn_count: newTurnRows.length,
      documents: documents.map((document) => ({
        key: document.key,
        updated_at: document.updated_at,
      })),
    });
    await tasknerveAppendJsonl(tasknerveTraceTurnsPath(normalizedRoot), newTurnRows);
    traceState.last_capture_id = captureId;
    traceState.last_capture_at_utc = capturedAtUtc;
    traceState.seen_turn_keys = seenTurnKeys;
    await tasknerveWritePrettyJson(traceStatePayload.file_path, traceState);
    const nativeSettings = await tasknerveWriteNativeProjectSettings(normalizedRoot, {
      trace_last_capture_at_utc: capturedAtUtc,
      trace_last_capture_id: captureId,
      ...(nativeSettingsPayload && typeof nativeSettingsPayload === "object"
        ? nativeSettingsPayload
        : {}),
    });
    return {
      ok: true,
      capture_id: captureId,
      captured_at_utc: capturedAtUtc,
      capture_file: captureFilePath,
      trace_root: tasknerveTraceRoot(normalizedRoot),
      thread_count: capturedThreads.length,
      new_turn_count: newTurnRows.length,
      thread_errors: threadErrors,
      settings: nativeSettings.settings,
    };
  }

  async function tasknerveHandleSystemResources(body) {
    const resources = await tasknerveSampleSystemResources(
      Boolean(body?.force_fresh ?? body?.forceFresh),
    );
    const maxWorkersValue = Number(body?.max_workers ?? body?.maxWorkers ?? 0);
    return {
      ok: true,
      transport: "codex_native",
      resources,
      recommended_worker_cap: tasknerveRecommendedWorkerCap(resources, maxWorkersValue),
      max_workers: Number.isFinite(maxWorkersValue) && maxWorkersValue > 0
        ? Math.floor(maxWorkersValue)
        : null,
    };
  }

  async function tasknerveHandleEnsureProjectDocumentsFromUrl(url) {
    return tasknerveHandleEnsureProjectDocuments({
      project_root: tasknerveQueryText(url, "project_root"),
      project_name: tasknerveQueryText(url, "project_name"),
    });
  }

  async function tasknerveHandleReadProjectDocumentFromUrl(url) {
    return tasknerveHandleReadProjectDocument({
      project_root: tasknerveQueryText(url, "project_root"),
      project_name: tasknerveQueryText(url, "project_name"),
      doc_key: tasknerveQueryText(url, "doc_key"),
    });
  }

  async function tasknerveHandleWriteProjectDocumentFromUrl(url) {
    const contentBase64 = tasknerveQueryText(url, "content_b64") || "";
    return tasknerveHandleWriteProjectDocument({
      project_root: tasknerveQueryText(url, "project_root"),
      project_name: tasknerveQueryText(url, "project_name"),
      doc_key: tasknerveQueryText(url, "doc_key"),
      content: Buffer.from(contentBase64, "base64").toString("utf8"),
    });
  }

  async function tasknerveHandleReadProjectNativeSettingsFromUrl(url) {
    return tasknerveHandleReadProjectNativeSettings({
      project_root: tasknerveQueryText(url, "project_root"),
      project_name: tasknerveQueryText(url, "project_name"),
    });
  }

  async function tasknerveHandleSystemResourcesFromUrl(url) {
    return tasknerveHandleSystemResources({
      max_workers: tasknerveQueryText(url, "max_workers"),
      force_fresh: tasknerveQueryText(url, "force_fresh"),
    });
  }

  async function tasknerveHandleOpenThread(body) {
    const threadId = tasknerveRequiredText(body.thread_id ?? body.threadId, "thread_id");
    if (
      typeof TASKNERVE_ENSURE_WINDOW !== "function" ||
      typeof TASKNERVE_NAVIGATE_ROUTE !== "function" ||
      !TASKNERVE_LOCAL_HOST_CONFIG ||
      !TASKNERVE_LOCAL_HOST_CONFIG.id
    ) {
      throw new Error("Codex window routing is unavailable");
    }
    const windowRef = await TASKNERVE_ENSURE_WINDOW(TASKNERVE_LOCAL_HOST_CONFIG.id);
    if (!windowRef) {
      throw new Error("Codex main window is unavailable");
    }
    if (typeof windowRef.isMinimized === "function" && windowRef.isMinimized()) {
      windowRef.restore();
    }
    windowRef.show();
    windowRef.focus();
    TASKNERVE_NAVIGATE_ROUTE(windowRef, `/local/${threadId}`);
    return {
      ok: true,
      thread_id: threadId,
    };
  }

  function tasknerveProjectWindowRoute(body) {
    const explicitRoute = tasknerveOptionalText(body.route_path ?? body.routePath);
    const projectKey = tasknerveOptionalText(body.project_key ?? body.projectKey);
    const threadId = tasknerveOptionalText(body.thread_id ?? body.threadId);
    let routePath = explicitRoute || (threadId ? `/local/${threadId}` : `/`);
    const routeUrl = new URL(routePath, TASKNERVE_BRIDGE_ORIGIN);
    if (projectKey) {
      routeUrl.searchParams.set("tasknerveProject", projectKey);
    }
    return `${routeUrl.pathname}${routeUrl.search}`;
  }

  async function tasknerveHandleOpenProjectWindow(body) {
    if (
      !TASKNERVE_WINDOW_MANAGER ||
      typeof TASKNERVE_WINDOW_MANAGER.createWindow !== "function" ||
      typeof TASKNERVE_NAVIGATE_ROUTE !== "function" ||
      !TASKNERVE_LOCAL_HOST_CONFIG ||
      !TASKNERVE_LOCAL_HOST_CONFIG.id
    ) {
      throw new Error("Codex window manager is unavailable");
    }
    const projectName =
      tasknerveOptionalText(body.project_name ?? body.projectName) ||
      tasknerveOptionalText(body.project_key ?? body.projectKey) ||
      "Project";
    const title =
      tasknerveOptionalText(body.title) ||
      `${projectName} · ${electron?.app?.getName?.() || "Codex TaskNerve"}`;
    const windowRef = await TASKNERVE_WINDOW_MANAGER.createWindow({
      title,
      hostId: TASKNERVE_LOCAL_HOST_CONFIG.id,
      show: true,
    });
    if (!windowRef) {
      throw new Error("Failed to create project window");
    }
    if (typeof windowRef.isMinimized === "function" && windowRef.isMinimized()) {
      windowRef.restore();
    }
    windowRef.show();
    windowRef.focus();
    const route = tasknerveProjectWindowRoute(body);
    TASKNERVE_NAVIGATE_ROUTE(windowRef, route);
    return {
      ok: true,
      host_id: TASKNERVE_LOCAL_HOST_CONFIG.id,
      route,
      window_id: typeof windowRef.id === "number" ? windowRef.id : null,
      project_key: tasknerveOptionalText(body.project_key ?? body.projectKey),
      thread_id: tasknerveOptionalText(body.thread_id ?? body.threadId),
      title,
    };
  }

  async function tasknerveHandleDockNewWindow() {
    const body = await tasknerveDefaultProjectWindowBody();
    return tasknerveHandleOpenProjectWindow(body || {});
  }

  function tasknerveInstallDockMenu() {
    if (tasknerveDockMenuInitialized || process.platform !== "darwin") {
      return;
    }
    const app = electron?.app;
    const Menu = electron?.Menu;
    if (
      !app ||
      !app.dock ||
      typeof app.dock.setMenu !== "function" ||
      !Menu ||
      typeof Menu.buildFromTemplate !== "function"
    ) {
      return;
    }
    const menu = Menu.buildFromTemplate([
      {
        label: "New Window",
        click: () => {
          void tasknerveHandleDockNewWindow().catch((error) => {
            tasknerveLog("error", "Failed to open TaskNerve window from dock menu", error);
          });
        },
      },
    ]);
    app.dock.setMenu(menu);
    tasknerveDockMenuInitialized = true;
  }

  if (process.platform === "darwin" && electron?.app?.whenReady) {
    electron.app
      .whenReady()
      .then(() => {
        tasknerveInstallDockMenu();
      })
      .catch((error) => {
        tasknerveLog("error", "Failed to initialize TaskNerve dock menu", error);
      });
  }

  async function tasknerveHandleTasksSnapshot(url) {
    return tasknerveSnapshotPayload(tasknerveQueryText(url, "project"));
  }

  async function tasknerveHandleProjectForThread(url) {
    const threadId = tasknerveRequiredText(tasknerveQueryText(url, "thread_id"), "thread_id");
    return tasknerveProjectForThread(threadId);
  }

  async function tasknerveHandleAddTask(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const title = tasknerveRequiredText(body.title, "title");
    return tasknerveWriteTaskMutation(projectSelector, async (taskState, selection) => {
      const now = tasknerveNowUtc();
      const task = {
        task_id: `task_${crypto.randomUUID().replace(/-/g, "")}`,
        title,
        detail: tasknerveOptionalText(body.detail) || null,
        priority: Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : 0,
        tags: Array.isArray(body.tags) ? body.tags.filter(Boolean) : [],
        depends_on: Array.isArray(body.depends_on) ? body.depends_on.filter(Boolean) : [],
        status: "open",
        created_at_utc: now,
        updated_at_utc: now,
        created_by_agent_id: tasknerveOptionalText(body.agent) || "tasknerve.native",
        claimed_by_agent_id: null,
        claim_started_at_utc: null,
        claim_expires_at_utc: null,
        completed_at_utc: null,
        completed_by_agent_id: null,
        completed_summary: null,
        completion_notes: [],
        completion_artifacts: [],
        completion_commands: [],
        source_key: null,
        source_plan: null,
        awaiting_confirmation: false,
        approved_at_utc: null,
        approved_by_agent_id: null,
        blocked_at_utc: null,
        blocked_by_agent_id: null,
        blocked_reason: null,
        canceled_at_utc: null,
        canceled_by_agent_id: null,
        canceled_reason: null,
        progress_entries: [],
        artifact_entries: [],
        suggested_intelligence: tasknerveOptionalText(body.suggested_intelligence),
        suggested_model: tasknerveOptionalText(body.suggested_model),
      };
      taskState.tasks.push(task);
      return {
        ok: true,
        action: "add",
        selected_project: {
          key: selection.selected.key,
          name: selection.selected.name,
          repo_root: selection.selected.repo_root,
        },
        task: tasknerveTaskPayload(
          task,
          new Map(taskState.tasks.map((entry) => [entry.task_id, entry])),
        ),
      };
    });
  }

  async function tasknerveHandleEditTask(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const taskId = tasknerveRequiredText(body.task_id, "task_id");
    return tasknerveWriteTaskMutation(projectSelector, async (taskState, selection) => {
      const task = taskState.tasks.find((entry) => entry.task_id === taskId);
      if (!task) {
        throw new Error(`Unknown task: ${taskId}`);
      }
      if (body.title !== undefined) {
        task.title = tasknerveRequiredText(body.title, "title");
      }
      if (body.detail !== undefined) {
        task.detail = tasknerveOptionalText(body.detail);
      }
      if (body.priority !== undefined) {
        task.priority = Number.isFinite(Number(body.priority)) ? Math.trunc(Number(body.priority)) : task.priority;
      }
      if (body.tags !== undefined) {
        task.tags = Array.isArray(body.tags) ? body.tags.filter(Boolean) : [];
      }
      if (body.depends_on !== undefined) {
        task.depends_on = Array.isArray(body.depends_on) ? body.depends_on.filter(Boolean) : [];
      }
      if (body.suggested_intelligence !== undefined) {
        task.suggested_intelligence = tasknerveOptionalText(body.suggested_intelligence);
      }
      if (body.suggested_model !== undefined) {
        task.suggested_model = tasknerveOptionalText(body.suggested_model);
      }
      task.updated_at_utc = tasknerveNowUtc();
      return {
        ok: true,
        action: "edit",
        changed: true,
        selected_project: {
          key: selection.selected.key,
          name: selection.selected.name,
          repo_root: selection.selected.repo_root,
        },
        task: tasknerveTaskPayload(
          task,
          new Map(taskState.tasks.map((entry) => [entry.task_id, entry])),
        ),
      };
    });
  }

  async function tasknerveHandleRemoveTask(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const taskId = tasknerveRequiredText(body.task_id, "task_id");
    return tasknerveWriteTaskMutation(projectSelector, async (taskState, selection) => {
      const index = taskState.tasks.findIndex((entry) => entry.task_id === taskId);
      if (index < 0) {
        throw new Error(`Unknown task: ${taskId}`);
      }
      const [task] = taskState.tasks.splice(index, 1);
      return {
        ok: true,
        action: "remove",
        selected_project: {
          key: selection.selected.key,
          name: selection.selected.name,
          repo_root: selection.selected.repo_root,
        },
        task,
      };
    });
  }

  async function tasknerveHandleApproveTask(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const taskId = tasknerveOptionalText(body.task_id);
    return tasknerveWriteTaskMutation(projectSelector, async (taskState, selection) => {
      const now = tasknerveNowUtc();
      const approved = taskState.tasks.filter((task) => {
        const matchesTarget = taskId ? task.task_id === taskId : true;
        return matchesTarget && task.awaiting_confirmation;
      });
      approved.forEach((task) => {
        task.awaiting_confirmation = false;
        task.approved_at_utc = now;
        task.approved_by_agent_id = tasknerveOptionalText(body.agent) || "tasknerve.native";
        task.updated_at_utc = now;
      });
      return {
        ok: true,
        action: "approve",
        selected_project: {
          key: selection.selected.key,
          name: selection.selected.name,
          repo_root: selection.selected.repo_root,
        },
        approved_count: approved.length,
        tasks: approved,
      };
    });
  }

  async function tasknerveHandleSaveProjectSettings(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const gitSyncPolicy = tasknerveOptionalText(body.git_sync_policy) || "every_task";
    const gitSyncEveryNTasks = Math.max(
      1,
      Math.floor(Number(body.git_sync_every_n_tasks || 1) || 1),
    );
    const settings = await tasknerveWriteProjectCodexSettings(selection.repoRoot, {
      ...body,
      heartbeat_message_core: body.heartbeat_message_core || undefined,
      low_queue_controller_prompt: body.low_queue_controller_prompt || undefined,
      worker_default_model: tasknerveOptionalText(body.worker_default_model),
      controller_default_model: tasknerveOptionalText(body.controller_default_model),
      low_intelligence_model: tasknerveOptionalText(body.low_intelligence_model),
      medium_intelligence_model: tasknerveOptionalText(body.medium_intelligence_model),
      high_intelligence_model: tasknerveOptionalText(body.high_intelligence_model),
      max_intelligence_model: tasknerveOptionalText(body.max_intelligence_model),
      git_origin_url: tasknerveOptionalText(body.git_origin_url),
      git_sync_policy:
        gitSyncPolicy === "manual" || gitSyncPolicy === "every_n_tasks"
          ? gitSyncPolicy
          : "every_task",
      git_sync_every_n_tasks: gitSyncEveryNTasks,
    });
    const codexState = await tasknerveLoadCodexThreadState(selection.repoRoot);
    if (settings.heartbeat_message_core) {
      codexState.bindings = codexState.bindings.map((binding) =>
        tasknerveIsControllerAgent(binding.agent_id)
          ? binding
          : { ...binding, heartbeat_message: settings.heartbeat_message_core, updated_at_utc: tasknerveNowUtc() },
      );
      await tasknerveWriteCodexThreadState(selection.repoRoot, codexState);
    }
    return {
      ok: true,
      action: "project_codex_settings",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      changed: true,
      heartbeat_synced_to_workers: true,
      git_origin_applied: false,
      settings,
    };
  }

  async function tasknerveHandleSwitchTimelineBranch(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const branchName = tasknerveRequiredText(body.branch_name ?? body.branch, "branch_name");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadBranchesState(selection.repoRoot);
    if (!state.branches || !state.branches[branchName]) {
      throw new Error(`Timeline branch does not exist: ${branchName}`);
    }
    state.active_branch = branchName;
    await tasknerveWriteBranchesState(selection.repoRoot, state);
    return {
      ok: true,
      action: "timeline_branch_switch",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      timeline: {
        timeline_initialized: true,
        active_branch: state.active_branch,
        branches: Object.keys(state.branches).sort(),
        git_branch_hint: tasknerveDetectGitBranch(selection.repoRoot),
      },
    };
  }

  async function tasknerveHandleCreateTimelineBranch(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const branchName = tasknerveRequiredText(body.branch_name ?? body.branch, "branch_name");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadBranchesState(selection.repoRoot);
    if (state.branches[branchName]) {
      throw new Error(`Timeline branch already exists: ${branchName}`);
    }
    const now = tasknerveNowUtc();
    state.branches[branchName] = {
      name: branchName,
      head_event_id: null,
      created_at_utc: now,
      from_branch: state.active_branch || null,
      from_event_id: null,
    };
    state.active_branch = branchName;
    await tasknerveWriteBranchesState(selection.repoRoot, state);
    return {
      ok: true,
      action: "timeline_branch_create",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      timeline: {
        timeline_initialized: true,
        active_branch: state.active_branch,
        branches: Object.keys(state.branches).sort(),
        git_branch_hint: tasknerveDetectGitBranch(selection.repoRoot),
      },
    };
  }

  async function tasknerveHandleBindThread(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    const threadId = tasknerveRequiredText(body.thread_id ?? body.threadId, "thread_id");
    const controller = Boolean(body.controller);
    const existingBinding = state.bindings.find((binding) => binding.thread_id === threadId) || null;
    const agentId = controller
      ? tasknerveControllerAgentId()
      : tasknerveOptionalText(existingBinding?.agent_id) || tasknerveNextWorkerAgentId(state, threadId);
    const label = controller
      ? tasknerveOptionalText(body.label) || tasknerveOptionalText(existingBinding?.label)
      : tasknerveResolvedWorkerLabel(
          state,
          selection.selected.name,
          threadId,
          body.label ?? existingBinding?.label,
        );
    const now = tasknerveNowUtc();
    state.bindings = state.bindings.filter((binding) =>
      binding.thread_id !== threadId && binding.agent_id !== agentId,
    );
    const binding = {
      agent_id: agentId,
      thread_id: threadId,
      label,
      heartbeat_message: tasknerveOptionalText(body.heartbeat_message ?? body.heartbeatMessage),
      created_at_utc: now,
      updated_at_utc: now,
      last_injected_at_utc: null,
      last_task_id: null,
      last_result_excerpt: null,
      last_error: null,
    };
    state.bindings.push(binding);
    await tasknerveWriteCodexThreadState(selection.repoRoot, state);
    if (!controller && label) {
      await tasknerveHandleSetThreadName({ thread_id: threadId, title: label }).catch(() => null);
    }
    return {
      ok: true,
      action: "codex_bind",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      binding,
      snapshot: tasknerveCodexSnapshotPayload(state),
    };
  }

  async function tasknerveHandleUnbindThread(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    const agentId = tasknerveRequiredText(body.agent_id ?? body.agentId, "agent_id");
    const binding = state.bindings.find((entry) => entry.agent_id === agentId) || null;
    state.bindings = state.bindings.filter((entry) => entry.agent_id !== agentId);
    await tasknerveWriteCodexThreadState(selection.repoRoot, state);
    return {
      ok: true,
      action: "codex_unbind",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      binding,
      snapshot: tasknerveCodexSnapshotPayload(state),
    };
  }

  async function tasknerveHandleBootstrapController(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const forceNew = Boolean(body.force_new ?? body.forceNew);
    const openThread = body.open_thread !== false;
    let state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    const existing = state.bindings.find((binding) => tasknerveIsControllerAgent(binding.agent_id)) || null;
    if (existing && !forceNew) {
      if (openThread && existing.thread_id) {
        await tasknerveHandleOpenThread({ thread_id: existing.thread_id }).catch(() => null);
      }
      return {
        ok: true,
        action: "controller_bootstrap",
        selected_project: {
          key: selection.selected.key,
          name: selection.selected.name,
          repo_root: selection.selected.repo_root,
        },
        result: {
          ok: true,
          status: "already_bound",
          opened: !!(openThread && existing.thread_id),
          binding: existing,
          snapshot: tasknerveCodexSnapshotPayload(state),
        },
      };
    }
    const settings = await tasknerveLoadProjectCodexSettings(selection.repoRoot);
    const thread = await tasknerveHandleStartThread({
      cwd: selection.repoRoot,
      model: settings.controller_default_model || null,
      sandbox: "workspace-write",
      approval_policy: "never",
    });
    const threadId = tasknerveRequiredText(thread.thread_id, "thread_id");
    const title = `${selection.selected.name}-Controller`;
    await tasknerveHandleSetThreadName({ thread_id: threadId, title });
    const now = tasknerveNowUtc();
    const binding = {
      agent_id: tasknerveControllerAgentId(),
      thread_id: threadId,
      label: title,
      heartbeat_message: null,
      created_at_utc: now,
      updated_at_utc: now,
      last_injected_at_utc: null,
      last_task_id: null,
      last_result_excerpt: null,
      last_error: null,
    };
    state.bindings = state.bindings.filter((entry) => !tasknerveIsControllerAgent(entry.agent_id));
    state.bindings.push(binding);
    await tasknerveWriteCodexThreadState(selection.repoRoot, state);
    const prompt = `Please familiarize yourself with the \`${selection.selected.name}\` project. You are the TaskNerve controller for this repository.\n\nController responsibilities:\n- Understand the current repository state and the project intent.\n- Treat TaskNerve as the source of truth for backlog orchestration and worker coordination.\n- Review project_goals.md, project_manifest.md, and contributing ideas.md.\n- If the goals or manifest are still draft-quality, refine them with the user before expanding the backlog.\n- Once the project contracts are solid enough, populate TaskNerve with concrete development and maintenance tasks and keep worker threads productive.\n- Use the built-in TaskNerve skill when it helps you move faster and stay aligned.\n\nProject root: ${selection.repoRoot}`;
    const promptResult = await tasknerveHandleStartTurn({
      thread_id: threadId,
      prompt,
      cwd: selection.repoRoot,
      model: settings.controller_default_model || null,
      summary: "tasknerve controller bootstrap",
    });
    if (openThread) {
      await tasknerveHandleOpenThread({ thread_id: threadId }).catch(() => null);
    }
    state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    return {
      ok: true,
      action: "controller_bootstrap",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      result: {
        ok: true,
        status: "created",
        opened: openThread,
        thread_id: threadId,
        title,
        binding,
        prompt_result: promptResult,
        snapshot: tasknerveCodexSnapshotPayload(state),
      },
    };
  }

  async function tasknerveHandleAdoptActive(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    const hostContext = await tasknerveHandleHostContext();
    const threadId = tasknerveOptionalText(hostContext?.active_thread_id);
    if (!threadId) {
      throw new Error("No active Codex thread is available to adopt");
    }
    const existingBinding = state.bindings.find((binding) => binding.thread_id === threadId) || null;
    const currentThreadRecord = await tasknerveHandleReadThread({
      thread_id: threadId,
      include_turns: false,
    }).catch(() => null);
    const currentThreadLabel =
      tasknerveOptionalText(existingBinding?.label) ||
      tasknerveOptionalText(body.label) ||
      tasknerveOptionalText(currentThreadRecord?.thread?.title) ||
      tasknerveOptionalText(currentThreadRecord?.thread?.name);
    const label = tasknerveResolvedWorkerLabel(
      state,
      selection.selected.name,
      threadId,
      currentThreadLabel,
    );
    const now = tasknerveNowUtc();
    const binding = {
      agent_id: tasknerveOptionalText(existingBinding?.agent_id) || tasknerveNextWorkerAgentId(state, threadId),
      thread_id: threadId,
      label,
      heartbeat_message: tasknerveOptionalText(body.heartbeat_message ?? body.heartbeatMessage),
      created_at_utc: now,
      updated_at_utc: now,
      last_injected_at_utc: null,
      last_task_id: null,
      last_result_excerpt: null,
      last_error: null,
    };
    state.bindings = state.bindings.filter((entry) => entry.thread_id !== threadId);
    state.bindings.push(binding);
    await tasknerveWriteCodexThreadState(selection.repoRoot, state);
    if (label) {
      await tasknerveHandleSetThreadName({ thread_id: threadId, title: label }).catch(() => null);
    }
    return {
      ok: true,
      action: "codex_adopt_active",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      result: {
        ok: true,
        adopted_count: 1,
        adopted: [binding],
        snapshot: tasknerveCodexSnapshotPayload(state),
      },
    };
  }

  async function tasknerveHandleHeartbeatActive(url, body) {
    const projectSelector = tasknerveQueryText(url, "project");
    const selection = await tasknerveResolveProjectSelection(projectSelector);
    const state = await tasknerveLoadCodexThreadState(selection.repoRoot);
    const settings = await tasknerveLoadProjectCodexSettings(selection.repoRoot);
    const workers = state.bindings.filter((binding) => !tasknerveIsControllerAgent(binding.agent_id));
    const heartbeatTemplate =
      tasknerveOptionalText(body.heartbeat_message ?? body.heartbeatMessage) ||
      settings.heartbeat_message_core;
    const prompt = heartbeatTemplate.replaceAll("{project_name}", selection.selected.name);
    const results = [];
    for (const binding of workers) {
      const startTurnResult = await tasknerveHandleStartTurn({
        thread_id: binding.thread_id,
        prompt,
        cwd: selection.repoRoot,
        model: settings.worker_default_model || null,
        summary: "tasknerve heartbeat",
      });
      binding.last_injected_at_utc = tasknerveNowUtc();
      binding.last_result_excerpt = "heartbeat sent";
      binding.updated_at_utc = binding.last_injected_at_utc;
      state.queued_prompts.push({
        prompt_id: `prompt_${crypto.randomUUID().replace(/-/g, "")}`,
        agent_id: binding.agent_id,
        thread_id: binding.thread_id,
        kind: "continue_task",
        prompt,
        claim_ttl_minutes: Number(body.claim_ttl_minutes || 30),
        steal_after_minutes: Number(body.steal_after_minutes || 90),
        exclude_tags: Array.isArray(body.exclude_tags) ? body.exclude_tags : [],
        model: settings.worker_default_model || null,
        oss: false,
        local_provider: null,
        status: "sent",
        created_at_utc: binding.last_injected_at_utc,
        started_at_utc: binding.last_injected_at_utc,
        finished_at_utc: binding.last_injected_at_utc,
        task_id: null,
        result_excerpt: "heartbeat sent",
        error: null,
      });
      results.push(startTurnResult);
    }
    state.queued_prompts = state.queued_prompts.slice(-200);
    await tasknerveWriteCodexThreadState(selection.repoRoot, state);
    return {
      ok: true,
      action: "codex_heartbeat_active",
      selected_project: {
        key: selection.selected.key,
        name: selection.selected.name,
        repo_root: selection.selected.repo_root,
      },
      result: {
        ok: true,
        queued_count: results.length,
        results,
        snapshot: tasknerveCodexSnapshotPayload(state),
      },
    };
  }

  async function tasknerveHandleRoute(req, res) {
    const url = new URL(req.url || "/", TASKNERVE_BRIDGE_ORIGIN);
    if (req.method === "OPTIONS") {
      tasknerveWriteJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/health") {
      tasknerveWriteJson(res, 200, await tasknerveHandleHealth());
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/host/context") {
      tasknerveWriteJson(res, 200, await tasknerveHandleHostContext());
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/project/documents/ensure") {
      tasknerveWriteJson(res, 200, await tasknerveHandleEnsureProjectDocumentsFromUrl(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/project/document/read") {
      tasknerveWriteJson(res, 200, await tasknerveHandleReadProjectDocumentFromUrl(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/project/document/write") {
      tasknerveWriteJson(res, 200, await tasknerveHandleWriteProjectDocumentFromUrl(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/project/native-settings") {
      tasknerveWriteJson(res, 200, await tasknerveHandleReadProjectNativeSettingsFromUrl(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/system/resources") {
      tasknerveWriteJson(res, 200, await tasknerveHandleSystemResourcesFromUrl(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/api/tasks") {
      tasknerveWriteJson(res, 200, await tasknerveHandleTasksSnapshot(url));
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasknerve/api/codex/project-for-thread") {
      tasknerveWriteJson(res, 200, await tasknerveHandleProjectForThread(url));
      return;
    }
    if (req.method !== "POST") {
      tasknerveWriteJson(res, 405, { ok: false, error: "POST required" });
      return;
    }
    const body = await tasknerveReadJson(req);
    let payload = null;
    switch (url.pathname) {
      case "/tasknerve/thread/start-turn":
        payload = await tasknerveHandleStartTurn(body);
        break;
      case "/tasknerve/thread/start-thread":
        payload = await tasknerveHandleStartThread(body);
        break;
      case "/tasknerve/thread/set-name":
        payload = await tasknerveHandleSetThreadName(body);
        break;
      case "/tasknerve/thread/update-title":
        payload = await tasknerveHandleUpdateThreadTitle(body);
        break;
      case "/tasknerve/thread/read":
        payload = await tasknerveHandleReadThread(body);
        break;
      case "/tasknerve/project/documents/ensure":
        payload = await tasknerveHandleEnsureProjectDocuments(body);
        break;
      case "/tasknerve/project/document/read":
        payload = await tasknerveHandleReadProjectDocument(body);
        break;
      case "/tasknerve/project/document/write":
        payload = await tasknerveHandleWriteProjectDocument(body);
        break;
      case "/tasknerve/project/register":
        payload = await tasknerveHandleRegisterProject(body);
        break;
      case "/tasknerve/project/open-vscode":
        payload = await tasknerveHandleOpenProjectInVsCode(body);
        break;
      case "/tasknerve/project/native-settings":
        payload = await tasknerveHandleWriteProjectNativeSettings(body);
        break;
      case "/tasknerve/project/trace/capture":
        payload = await tasknerveHandleCaptureProjectTrace(body);
        break;
      case "/tasknerve/system/resources":
        payload = await tasknerveHandleSystemResources(body);
        break;
      case "/tasknerve/api/tasks/add":
        payload = await tasknerveHandleAddTask(url, body);
        break;
      case "/tasknerve/api/tasks/edit":
        payload = await tasknerveHandleEditTask(url, body);
        break;
      case "/tasknerve/api/tasks/remove":
        payload = await tasknerveHandleRemoveTask(url, body);
        break;
      case "/tasknerve/api/tasks/approve":
        payload = await tasknerveHandleApproveTask(url, body);
        break;
      case "/tasknerve/api/project/codex-settings":
        payload = await tasknerveHandleSaveProjectSettings(url, body);
        break;
      case "/tasknerve/api/timeline/branch/switch":
        payload = await tasknerveHandleSwitchTimelineBranch(url, body);
        break;
      case "/tasknerve/api/timeline/branch/create":
        payload = await tasknerveHandleCreateTimelineBranch(url, body);
        break;
      case "/tasknerve/api/codex/bind":
        payload = await tasknerveHandleBindThread(url, body);
        break;
      case "/tasknerve/api/codex/unbind":
        payload = await tasknerveHandleUnbindThread(url, body);
        break;
      case "/tasknerve/api/codex/controller/bootstrap":
        payload = await tasknerveHandleBootstrapController(url, body);
        break;
      case "/tasknerve/api/codex/adopt-active":
        payload = await tasknerveHandleAdoptActive(url, body);
        break;
      case "/tasknerve/api/codex/heartbeat-active":
        payload = await tasknerveHandleHeartbeatActive(url, body);
        break;
      case "/tasknerve/thread/open":
        payload = await tasknerveHandleOpenThread(body);
        break;
      case "/tasknerve/window/open-project":
        payload = await tasknerveHandleOpenProjectWindow(body);
        break;
      default:
        tasknerveWriteJson(res, 404, { ok: false, error: "Unknown TaskNerve route" });
        return;
    }
    tasknerveWriteJson(res, 200, payload);
  }

  function tasknerveStartServer() {
    if (globalThis.__TASKNERVE_CODEX_NATIVE_BRIDGE_SERVER__) {
      return;
    }
    const server = http.createServer((req, res) => {
      Promise.resolve(tasknerveHandleRoute(req, res)).catch((error) => {
        tasknerveLog("warn", "Native bridge request failed", error);
        tasknerveWriteJson(res, 500, {
          ok: false,
          error: error && error.message ? error.message : String(error),
        });
      });
    });
    server.on("clientError", (error, socket) => {
      tasknerveLog("warn", "Native bridge client error", error);
      try {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      } catch (_error) {}
    });
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        tasknerveLog("info", `Native bridge already listening on ${TASKNERVE_BRIDGE_ORIGIN}`);
        return;
      }
      tasknerveLog("warn", "Native bridge server error", error);
    });
    server.listen(TASKNERVE_BRIDGE_PORT, TASKNERVE_BRIDGE_HOST, () => {
      tasknerveLog("info", `Native bridge listening on ${TASKNERVE_BRIDGE_ORIGIN}`);
    });
    if (typeof server.unref === "function") {
      server.unref();
    }
    globalThis.__TASKNERVE_CODEX_NATIVE_BRIDGE_SERVER__ = server;
  }

  const tasknerveElectronApp = electron?.app;
  if (tasknerveElectronApp && typeof tasknerveElectronApp.whenReady === "function") {
    tasknerveElectronApp.whenReady().then(tasknerveStartServer).catch((error) => {
      tasknerveLog("warn", "Native bridge failed to start", error);
    });
    if (typeof tasknerveElectronApp.on === "function") {
      tasknerveElectronApp.on("will-quit", () => {
        const server = globalThis.__TASKNERVE_CODEX_NATIVE_BRIDGE_SERVER__;
        if (server && typeof server.close === "function") {
          try {
            server.close();
          } catch (_error) {}
        }
      });
    }
  }
})();
