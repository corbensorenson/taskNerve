import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCodexTaskNerveHostRuntime } from "../src/integration/codexTaskNerveHostRuntime.js";
import { createTaskNerveService } from "../src/integration/taskNerveService.js";

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
    subscribeTaskNerveTaskCountEvents: vi.fn(),
    subscribeTaskDrawerStateEvents: vi.fn(),
    subscribeTerminalPanelStateEvents: vi.fn(),
    subscribeTaskNerveBranchEvents: vi.fn(),
    subscribeTaskNerveResourceStatsEvents: vi.fn(),
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
    readRepositoryGitState: vi.fn(async () => ({
      branch: "tasknerve/main",
      remote: "origin",
      ahead_count: 2,
      behind_count: 1,
      changed_file_count: 0,
      staged_file_count: 0,
      untracked_file_count: 0,
      clean: true,
    })),
    pullRepository: vi.fn(async () => ({ ok: true })),
    pushRepository: vi.fn(async () => ({ ok: true })),
    readRepositoryCiFailures: vi.fn(async () => ({
      runs: [
        {
          provider: "github",
          workflow_name: "build",
          job_name: "unit",
          conclusion: "failure",
          ref: "refs/heads/tasknerve/main",
          head_sha: "abc123",
          html_url: "https://ci.example/runs/1",
          id: "1",
          completed_at: "2026-03-11T04:00:00.000Z",
        },
      ],
    })),
    upsertTaskNerveProjectTasks: vi.fn(async () => ({ ok: true })),
    dispatchTaskNerveTasks: vi.fn(async () => ({ ok: true })),
    listTaskNerveAgents: vi.fn(async () => ({ agent_ids: ["agent.ci", "agent.beta"] })),
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

  it("builds per-project git sync snapshots with cadence metrics", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-runtime-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.projectGitSyncSnapshot({
      repoRoot,
      tasks: [
        { task_id: "t1", title: "done one", status: "done" },
        { task_id: "t2", title: "done two", status: "done" },
        { task_id: "t3", title: "open three", status: "open" },
      ],
      nowIsoUtc: "2026-03-11T04:00:00.000Z",
    });

    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.repository.branch).toBe("tasknerve/main");
    expect(snapshot.task_metrics.done_task_count).toBe(2);
    expect(snapshot.task_metrics.done_tasks_since_last_push).toBe(2);
    expect(snapshot.task_metrics.average_tasks_before_push).toBe(null);
  });

  it("runs smart git sync through host pull/push and updates per-project push tracking", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-run-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectGit({
      repoRoot,
      tasks: [
        { task_id: "t1", title: "done one", status: "done" },
        { task_id: "t2", title: "done two", status: "done" },
        { task_id: "t3", title: "done three", status: "done" },
        { task_id: "t4", title: "done four", status: "done" },
      ],
      mode: "smart",
      nowIsoUtc: "2026-03-11T04:10:00.000Z",
    });

    expect(result.plan_reason).toBe("smart-pull-then-push");
    expect(result.executed.pull).toBe(true);
    expect(result.executed.push).toBe(true);
    expect(host.pullRepository).toHaveBeenCalledWith({
      repoRoot,
      autostash: true,
    });
    expect(host.pushRepository).toHaveBeenCalledWith({
      repoRoot,
    });
    expect(result.after.push_tracking.tasks_before_push_history.at(-1)).toBe(4);
  });

  it("auto-switches to preferred branch before git sync when branch policy is configured", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-auto-branch-"));
    const host = mockHostServices();
    host.readRepositoryGitState = vi
      .fn()
      .mockResolvedValueOnce({
        branch: "feature/perf",
        remote: "origin",
        ahead_count: 2,
        behind_count: 0,
        changed_file_count: 0,
        staged_file_count: 0,
        untracked_file_count: 0,
        clean: true,
      })
      .mockResolvedValue({
        branch: "tasknerve/main",
        remote: "origin",
        ahead_count: 2,
        behind_count: 0,
        changed_file_count: 0,
        staged_file_count: 0,
        untracked_file_count: 0,
        clean: true,
      });
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const service = createTaskNerveService();
    await service.writeProjectSettings(repoRoot, {
      git_preferred_branch: "tasknerve/main",
      git_auto_sync_allowed_branches: ["tasknerve/main"],
      git_tasks_per_push_target: 1,
      git_done_task_count_at_last_push: 0,
    });

    const result = await runtime.syncProjectGit({
      repoRoot,
      tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      mode: "smart",
      nowIsoUtc: "2026-03-11T04:12:00.000Z",
    });

    expect(host.switchTaskNerveBranch).toHaveBeenCalledWith("tasknerve/main");
    expect(result.after.repository.branch).toBe("tasknerve/main");
    expect(result.executed.push).toBe(true);
  });

  it("builds per-project CI sync snapshots with task upsert plans", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-sync-runtime-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.projectCiSyncSnapshot({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:05:00.000Z",
    });

    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.ci_metrics.unique_failure_count).toBe(1);
    expect(snapshot.task_upserts).toHaveLength(1);
    expect(snapshot.task_upserts[0]?.task.tags).toContain("ci");
  });

  it("syncs CI failures into project tasks and dispatches them", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-sync-run-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectCi({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:06:00.000Z",
    });

    expect(result.persisted_task_upserts).toBe(1);
    expect(result.dispatched_task_ids).toHaveLength(1);
    expect(result.settings.ci_last_failed_job_count).toBe(1);
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: expect.any(Array),
    });
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot,
      task_ids: result.dispatched_task_ids,
    });
  });

  it("memoizes CI agent discovery across rapid CI sync snapshots", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-agent-cache-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.projectCiSyncSnapshot({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:07:00.000Z",
    });
    await runtime.projectCiSyncSnapshot({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:07:01.000Z",
    });

    expect(host.listTaskNerveAgents).toHaveBeenCalledTimes(1);
    expect(host.readRepositoryCiFailures).toHaveBeenCalledTimes(1);
  });

  it("requests CI failures from host with a bounded limit", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-failure-limit-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.projectCiSyncSnapshot({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:08:00.000Z",
    });

    expect(host.readRepositoryCiFailures).toHaveBeenCalledWith({
      repoRoot,
      limit: 256,
    });
  });

  it("builds unified production snapshots combining git and CI bottlenecks", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-production-snapshot-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const snapshot = await runtime.projectProductionSnapshot({
      repoRoot,
      tasks: [],
      nowIsoUtc: "2026-03-11T04:09:00.000Z",
    });

    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.git.repository.branch).toBe("tasknerve/main");
    expect(snapshot.ci.ci_metrics.unique_failure_count).toBe(1);
    expect(snapshot.bottlenecks.some((entry) => entry.id === "ci-failures-detected")).toBe(true);
  });

  it("runs production sync as one native flow for CI tasking and git sync", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-production-sync-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectProduction({
      repoRoot,
      tasks: [
        { task_id: "t1", title: "done one", status: "done" },
        { task_id: "t2", title: "done two", status: "done" },
        { task_id: "t3", title: "done three", status: "done" },
        { task_id: "t4", title: "done four", status: "done" },
      ],
      mode: "smart",
      nowIsoUtc: "2026-03-11T04:10:00.000Z",
    });

    expect(result.integration_mode).toBe("codex-native-host");
    expect(result.executed.pull).toBe(true);
    expect(result.executed.push).toBe(true);
    expect(result.executed.ci_task_upserts).toBe(1);
    expect(result.executed.ci_dispatch_count).toBe(1);
    expect(result.timings_ms.total).toBeGreaterThanOrEqual(0);
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: expect.any(Array),
    });
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot,
      task_ids: expect.any(Array),
    });
    expect(host.pullRepository).toHaveBeenCalledWith({
      repoRoot,
      autostash: true,
    });
    expect(host.pushRepository).toHaveBeenCalledWith({
      repoRoot,
    });
  });

  it("automates controller project sync with git binding configured from input", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-auto-input-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.controllerProjectAutomation({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/tasknerve.git",
      tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      nowIsoUtc: "2026-03-11T04:11:00.000Z",
    });

    expect(result.integration_mode).toBe("codex-native-host");
    expect(result.tasknerve_managed_git).toBe(true);
    expect(result.git_binding.configured).toBe(true);
    expect(result.git_binding.source).toBe("input");
    expect(result.settings.git_origin_url).toBe("git@github.com:acme/tasknerve.git");
    expect(result.production_sync.integration_mode).toBe("codex-native-host");
    expect(host.pullRepository).toHaveBeenCalledWith({
      repoRoot,
      autostash: true,
    });
  });

  it("hydrates git binding from workspace context when settings are missing", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-auto-ws-"));
    const host = mockHostServices();
    host.getActiveWorkspaceContext = vi.fn(async () => ({
      repoRoot,
      gitOriginUrl: "https://github.com/acme/tasknerve.git",
    }));
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.controllerProjectAutomation({
      repoRoot,
      tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      nowIsoUtc: "2026-03-11T04:11:30.000Z",
    });

    expect(result.git_binding.configured).toBe(true);
    expect(result.git_binding.source).toBe("workspace-context");
    expect(result.settings.git_origin_url).toBe("https://github.com/acme/tasknerve.git");
    expect(result.warnings).toEqual(expect.not.arrayContaining([
      expect.stringContaining("git origin is not configured"),
    ]));
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

  it("invalidates snapshot cache after chrome actions without re-reading fresh state caches", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);

    await runtime.handleConversationChromeAction({
      type: "topbar-task-count-click",
    });
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);
  });

  it("reuses state read caches across rapid chrome invalidations", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);
    expect(host.readTaskNerveResourceStats).toHaveBeenCalledTimes(1);

    await runtime.handleConversationChromeAction({
      type: "topbar-task-count-click",
    });
    await runtime.conversationChromeSnapshot();

    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);
    expect(host.readTaskNerveResourceStats).toHaveBeenCalledTimes(1);
  });

  it("does not force chrome cache invalidation on thread refresh events", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);

    host.subscribeThreadEvents.mockImplementation((listener) => {
      listener({ type: "thread-updated", threadId: "thread-1" });
      return { dispose: vi.fn() };
    });
    await runtime.observeThreadRefresh({
      threadId: "thread-1",
      onEvent: vi.fn(),
    });

    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);
  });

  it("invalidates chrome cache on repository settings refresh events", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.conversationChromeSnapshot();
    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(1);

    host.subscribeRepositorySettingsEvents.mockImplementation((listener) => {
      listener({ type: "repo-settings-updated" });
      return { dispose: vi.fn() };
    });
    await runtime.observeRepositorySettingsRefresh({
      onEvent: vi.fn(),
    });

    await runtime.conversationChromeSnapshot();
    expect(host.readTaskNerveTaskCount).toHaveBeenCalledTimes(2);
  });

  it("uses optional chrome subscriptions to keep chrome mostly event-driven", async () => {
    const host = mockHostServices();
    const taskCountDispose = vi.fn();
    const drawerDispose = vi.fn();
    const terminalDispose = vi.fn();
    const branchDispose = vi.fn();
    const resourceDispose = vi.fn();
    host.subscribeTaskNerveTaskCountEvents.mockImplementation((listener) => {
      listener({ task_count: 21 });
      return { dispose: taskCountDispose };
    });
    host.subscribeTaskDrawerStateEvents.mockImplementation((listener) => {
      listener({ open: true });
      return { dispose: drawerDispose };
    });
    host.subscribeTerminalPanelStateEvents.mockImplementation((listener) => {
      listener({ open: false });
      return { dispose: terminalDispose };
    });
    host.subscribeTaskNerveBranchEvents.mockImplementation((listener) => {
      listener({ current_branch: "feature/perf", branches: ["feature/perf", "tasknerve/main"] });
      return { dispose: branchDispose };
    });
    host.subscribeTaskNerveResourceStatsEvents.mockImplementation((listener) => {
      listener({ cpu_percent: 33, gpu_percent: 9, memory_percent: 44 });
      return { dispose: resourceDispose };
    });

    const runtime = createCodexTaskNerveHostRuntime({ host });
    const onEvent = vi.fn();
    const subscription = await runtime.observeConversationChromeRefresh({
      onEvent,
    });

    expect(subscription.mode).toBe("host-event-subscription");
    expect(onEvent).toHaveBeenCalledTimes(5);

    const snapshot = await runtime.conversationChromeSnapshot();
    expect(snapshot.topbar.taskCountButton.taskCount).toBe(21);
    expect(snapshot.taskDrawer.open).toBe(true);
    expect(snapshot.footer.terminalToggle.active).toBe(false);
    expect(snapshot.footer.branchSelector.currentBranch).toBe("feature/perf");
    expect(snapshot.footer.resourceStats.cpuPercent).toBe(33);
    expect(snapshot.footer.resourceStats.gpuPercent).toBe(9);
    expect(snapshot.footer.resourceStats.memoryPercent).toBe(44);

    expect(host.readTaskNerveTaskCount).not.toHaveBeenCalled();
    expect(host.readTaskDrawerState).not.toHaveBeenCalled();
    expect(host.readTerminalPanelState).not.toHaveBeenCalled();
    expect(host.listTaskNerveBranches).not.toHaveBeenCalled();
    expect(host.readTaskNerveResourceStats).not.toHaveBeenCalled();

    subscription.dispose();
    expect(taskCountDispose).toHaveBeenCalledTimes(1);
    expect(drawerDispose).toHaveBeenCalledTimes(1);
    expect(terminalDispose).toHaveBeenCalledTimes(1);
    expect(branchDispose).toHaveBeenCalledTimes(1);
    expect(resourceDispose).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate parsed chrome events to reduce churn", async () => {
    const host = mockHostServices();
    const taskCountDispose = vi.fn();
    host.subscribeTaskNerveTaskCountEvents.mockImplementation((listener) => {
      listener({ task_count: 21 });
      listener({ task_count: 21 });
      return { dispose: taskCountDispose };
    });
    Reflect.deleteProperty(host, "subscribeTaskDrawerStateEvents");
    Reflect.deleteProperty(host, "subscribeTerminalPanelStateEvents");
    Reflect.deleteProperty(host, "subscribeTaskNerveBranchEvents");
    Reflect.deleteProperty(host, "subscribeTaskNerveResourceStatsEvents");

    const runtime = createCodexTaskNerveHostRuntime({ host });
    const onEvent = vi.fn();
    const subscription = await runtime.observeConversationChromeRefresh({
      onEvent,
    });

    expect(subscription.mode).toBe("host-event-subscription");
    expect(onEvent).toHaveBeenCalledTimes(1);

    const snapshot = await runtime.conversationChromeSnapshot();
    expect(snapshot.topbar.taskCountButton.taskCount).toBe(21);
    expect(host.readTaskNerveTaskCount).not.toHaveBeenCalled();

    subscription.dispose();
    expect(taskCountDispose).toHaveBeenCalledTimes(1);
  });

  it("accepts explicit empty branch state events without forcing host branch reads", async () => {
    const host = mockHostServices();
    const branchDispose = vi.fn();
    host.subscribeTaskNerveBranchEvents.mockImplementation((listener) => {
      listener({ branches: [] });
      return { dispose: branchDispose };
    });
    Reflect.deleteProperty(host, "subscribeTaskNerveTaskCountEvents");
    Reflect.deleteProperty(host, "subscribeTaskDrawerStateEvents");
    Reflect.deleteProperty(host, "subscribeTerminalPanelStateEvents");
    Reflect.deleteProperty(host, "subscribeTaskNerveResourceStatsEvents");

    const runtime = createCodexTaskNerveHostRuntime({ host });
    const subscription = await runtime.observeConversationChromeRefresh({
      onEvent: vi.fn(),
    });

    const snapshot = await runtime.conversationChromeSnapshot();
    expect(snapshot.footer.branchSelector.currentBranch).toBe("tasknerve/main");
    expect(host.listTaskNerveBranches).not.toHaveBeenCalled();

    subscription.dispose();
    expect(branchDispose).toHaveBeenCalledTimes(1);
  });

  it("falls back to manual refresh when optional chrome subscriptions are unavailable", async () => {
    const host = mockHostServices();
    Reflect.deleteProperty(host, "subscribeTaskNerveTaskCountEvents");
    Reflect.deleteProperty(host, "subscribeTaskDrawerStateEvents");
    Reflect.deleteProperty(host, "subscribeTerminalPanelStateEvents");
    Reflect.deleteProperty(host, "subscribeTaskNerveBranchEvents");
    Reflect.deleteProperty(host, "subscribeTaskNerveResourceStatsEvents");
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const onFallbackRefresh = vi.fn();

    const subscription = await runtime.observeConversationChromeRefresh({
      onEvent: vi.fn(),
      onFallbackRefresh,
    });

    expect(subscription.mode).toBe("fallback-manual-refresh");
    expect(onFallbackRefresh).toHaveBeenCalledTimes(1);
    subscription.dispose();
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
