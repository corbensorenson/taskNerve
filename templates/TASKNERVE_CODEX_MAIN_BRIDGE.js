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
    const electron = require("electron");
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
      case "/tasknerve/project/native-settings":
        payload = await tasknerveHandleWriteProjectNativeSettings(body);
        break;
      case "/tasknerve/project/trace/capture":
        payload = await tasknerveHandleCaptureProjectTrace(body);
        break;
      case "/tasknerve/system/resources":
        payload = await tasknerveHandleSystemResources(body);
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

  if (m && m.app && typeof m.app.whenReady === "function") {
    m.app.whenReady().then(tasknerveStartServer).catch((error) => {
      tasknerveLog("warn", "Native bridge failed to start", error);
    });
    if (typeof m.app.on === "function") {
      m.app.on("will-quit", () => {
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
