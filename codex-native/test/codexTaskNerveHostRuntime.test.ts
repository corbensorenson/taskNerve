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
    readTaskNerveTaskCount: vi.fn(async () => ({ task_count: 12 })),
    readTaskDrawerState: vi.fn(async () => ({ open: false })),
    openTaskDrawer: vi.fn(async () => ({ ok: true })),
    readTerminalPanelState: vi.fn(async () => ({ open: true })),
    toggleTerminalPanel: vi.fn(async () => ({ ok: true })),
    subscribeThreadEvents: vi.fn(),
    subscribeRepositorySettingsEvents: vi.fn(),
    listTaskNerveBranches: vi.fn(async () => ({
      current_branch: "tasknerve/main",
      branches: ["tasknerve/main", "feature/ab-test"],
    })),
    switchTaskNerveBranch: vi.fn(async () => ({ ok: true })),
    readTaskNerveResourceStats: vi.fn(async () => ({
      cpu_percent: 41,
      gpu_percent: 18,
      memory_percent: 57,
      thermal_pressure: "nominal",
      captured_at_utc: "2026-03-11T03:40:00.000Z",
    })),
    setConversationCurrentTurnKey: vi.fn(async () => ({ ok: true })),
    scrollConversationToTurn: vi.fn(async () => ({ ok: true })),
    scrollConversationToTop: vi.fn(async () => ({ ok: true })),
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

  it("exposes Codex conversation display snapshots through the runtime surface", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.conversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T12:00:00.000Z",
            input_items: [{ type: "message", text: "hi" }],
            output_items: [{ type: "message", text: "there" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
    });

    expect(snapshot.integrationMode).toBe("codex-native-host");
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.promptNavigation.userTurnKeys).toEqual(["user:turn-1"]);
  });

  it("exposes conversation interaction steps through the runtime surface", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const snapshot = await runtime.conversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T12:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T12:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
    });

    const interaction = await runtime.conversationInteractionStep({
      snapshot,
      event: {
        type: "jump-next-user-message",
        nowMs: 1000,
      },
    });

    expect(interaction.integrationMode).toBe("codex-native-host");
    expect(interaction.commands[0]).toMatchObject({
      type: "set-current-turn-key",
      turnKey: "user:turn-2",
    });
    expect(interaction.commands[1]).toMatchObject({
      type: "scroll-to-turn",
      turnKey: "user:turn-2",
    });
  });

  it("applies conversation interaction commands through native host methods", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const snapshot = await runtime.conversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T12:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T12:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
    });

    const applied = await runtime.applyConversationInteraction({
      snapshot,
      event: {
        type: "jump-next-user-message",
        nowMs: 1000,
      },
    });

    expect(applied.apply_summary.applied).toBe(2);
    expect(applied.apply_summary.skipped).toBe(0);
    expect(host.setConversationCurrentTurnKey).toHaveBeenCalledWith("user:turn-2");
    expect(host.scrollConversationToTurn).toHaveBeenCalledWith("user:turn-2", {
      behavior: "smooth",
      align: "start",
    });
    expect(host.setConversationCurrentTurnKey.mock.invocationCallOrder[0]).toBeLessThan(
      host.scrollConversationToTurn.mock.invocationCallOrder[0],
    );
  });

  it("builds conversation chrome snapshot with drawer button wiring and footer controls", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.conversationChromeSnapshot();

    expect(snapshot.integrationMode).toBe("codex-native-host");
    expect(snapshot.topbar.commitButton.visible).toBe(false);
    expect(snapshot.topbar.terminalToggle.visible).toBe(false);
    expect(snapshot.topbar.taskCountButton.taskCount).toBe(12);
    expect(snapshot.topbar.taskCountButton.action).toBe("topbar-task-count-click");

    expect(snapshot.footer.terminalToggle.visible).toBe(true);
    expect(snapshot.footer.terminalToggle.location).toBe("footer");
    expect(snapshot.footer.branchSelector.visible).toBe(true);
    expect(snapshot.footer.branchSelector.currentBranch).toBe("tasknerve/main");
    expect(snapshot.footer.resourceStats.cpuPercent).toBe(41);
    expect(snapshot.footer.resourceStats.gpuPercent).toBe(18);
  });

  it("memoizes conversation chrome host reads between back-to-back snapshots", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    await runtime.conversationChromeSnapshot();

    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);
    expect(host.readTaskDrawerState).toHaveBeenCalledTimes(1);
    expect(host.readTerminalPanelState).toHaveBeenCalledTimes(1);
    expect(host.listTaskNerveBranches).toHaveBeenCalledTimes(1);
  });

  it("opens task drawer when topbar task count button action is handled", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.handleConversationChromeAction({
      type: "topbar-task-count-click",
    });

    expect(result.ok).toBe(true);
    expect(result.task_drawer_open).toBe(true);
    expect(host.openTaskDrawer).toHaveBeenCalledTimes(1);
  });

  it("switches branches and toggles terminal from footer actions", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const toggle = await runtime.handleConversationChromeAction({
      type: "footer-terminal-toggle-click",
    });
    expect(toggle.ok).toBe(true);
    expect(host.toggleTerminalPanel).toHaveBeenCalledTimes(1);

    const switchResult = await runtime.handleConversationChromeAction({
      type: "footer-branch-switch",
      branch: "feature/ab-test",
    });
    expect(switchResult.ok).toBe(true);
    expect(switchResult.branch).toBe("feature/ab-test");
    expect(host.switchTaskNerveBranch).toHaveBeenCalledWith("feature/ab-test");
  });

  it("invalidates conversation chrome cache after chrome actions", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);

    await runtime.handleConversationChromeAction({
      type: "topbar-task-count-click",
    });
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(2);
  });

  it("uses host thread subscriptions for event-driven refresh when available", async () => {
    const host = mockHostServices();
    const hostDispose = vi.fn();
    host.subscribeThreadEvents.mockImplementation((listener, options) => {
      listener({ type: "thread-updated", threadId: "thread-1" });
      expect(options).toEqual({ threadId: "thread-1" });
      return { dispose: hostDispose };
    });
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const onEvent = vi.fn();

    const subscription = await runtime.observeThreadRefresh({
      threadId: "thread-1",
      onEvent,
    });

    expect(subscription.mode).toBe("host-event-subscription");
    expect(onEvent).toHaveBeenCalledWith({ type: "thread-updated", threadId: "thread-1" });
    subscription.dispose();
    expect(hostDispose).toHaveBeenCalledTimes(1);
  });

  it("falls back to manual refresh hooks when host subscriptions are unavailable", async () => {
    const host = mockHostServices();
    Reflect.deleteProperty(host, "subscribeRepositorySettingsEvents");
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const onEvent = vi.fn();
    const onFallbackRefresh = vi.fn();

    const subscription = await runtime.observeRepositorySettingsRefresh({
      onEvent,
      onFallbackRefresh,
    });

    expect(subscription.mode).toBe("fallback-manual-refresh");
    expect(onFallbackRefresh).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
});
