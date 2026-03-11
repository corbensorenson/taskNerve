import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCodexTaskNerveHostRuntime } from "../src/integration/codexTaskNerveHostRuntime.js";

function mockHostServices() {
  return {
    getActiveWorkspaceContext: vi.fn(async () => ({ repoRoot: "/tmp/repo" })),
    listProjectThreads: vi.fn(async () => []),
    startThread: vi.fn(async () => ({ thread_id: "thread-controller" })),
    startTurn: vi.fn(async () => ({ ok: true })),
    setThreadName: vi.fn(async () => ({ ok: true })),
    setThreadModel: vi.fn(async () => ({ ok: true })),
    pinThread: vi.fn(async () => ({ ok: true })),
    openThread: vi.fn(async () => ({ ok: true })),
    readRepositorySettings: vi.fn(async () => ({})),
    writeRepositorySettings: vi.fn(async () => ({ ok: true })),
    getCodexStylingContext: vi.fn(async () => ({ theme: "codex-default", density: "comfortable" })),
  };
}

describe("codex TaskNerve host runtime", () => {
  it("builds host-integrated snapshot with inherited styling contract", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-host-runtime-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.snapshot({
      repoRoot,
      projectName: "taskNerve",
      tasks: [
        { task_id: "b", title: "done", status: "done", priority: 1 },
        { task_id: "a", title: "open", status: "open", priority: 10 },
      ],
      search: "open",
    });

    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.styling.inherit_codex_host).toBe(true);
    expect(snapshot.host_styling_context).toEqual({
      theme: "codex-default",
      density: "comfortable",
    });
    expect(snapshot.task_snapshot.visible_tasks).toHaveLength(1);
    expect(snapshot.task_snapshot.visible_tasks[0]?.task_id).toBe("a");

    await runtime.snapshot({
      repoRoot,
      projectName: "taskNerve",
      tasks: [],
      search: "",
    });
    expect(host.getCodexStylingContext).toHaveBeenCalledTimes(1);
  });

  it("bootstraps the controller thread directly through Codex host services", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-runtime-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.bootstrapControllerThread({
      repoRoot,
      projectName: "taskNerve",
      currentStateSignals: ["integration-first"],
      queueSummary: "0 open tasks",
      threadTitle: "TaskNerve Controller",
    });

    expect(result.integration_mode).toBe("codex-native-host");
    expect(result.thread_id).toBe("thread-controller");
    expect(result.thread_title).toBe("TaskNerve Controller");

    expect(host.startThread).toHaveBeenCalledTimes(1);
    expect(host.setThreadName).toHaveBeenCalledWith("thread-controller", "TaskNerve Controller");
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    expect(host.pinThread).toHaveBeenCalledWith("thread-controller");
    expect(host.openThread).toHaveBeenCalledWith("thread-controller");
  });

  it("exposes thread display snapshots through the host runtime integration surface", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const thread = {
      turns: [
        {
          id: "turn-1",
          created_at: "2026-03-10T10:00:00.000Z",
          input_items: [{ type: "message", text: "hello" }],
          output_items: [{ type: "message", text: "world" }],
        },
      ],
    };

    const snapshot = await runtime.threadDisplaySnapshot({
      thread,
      current_turn_key: "assistant:turn-1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 400,
        viewport_height_px: 300,
      },
    });

    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.prompt_navigation.user_turn_keys).toEqual(["user:turn-1"]);
  });
});
