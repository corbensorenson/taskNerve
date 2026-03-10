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

  const http = require("node:http");

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

  async function tasknerveHandleHealth() {
    const { context } = tasknerveResolveLocalConnection();
    return {
      ok: true,
      host_id: context.hostId,
      bridge_origin: TASKNERVE_BRIDGE_ORIGIN,
      transport: "codex_native",
      capabilities: [
        "start_turn",
        "start_thread",
        "set_thread_name",
        "update_thread_title",
        "open_thread",
      ],
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
      case "/tasknerve/thread/open":
        payload = await tasknerveHandleOpenThread(body);
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
