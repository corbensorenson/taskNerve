import { mkdtemp, readFile } from "node:fs/promises";
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
    addWorkspaceRootOption: vi.fn(async () => ({ ok: true })),
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
    expect(result.model_transport.executed_mode).toBe("http");
  });

  it("prefers websocket transport for bootstrap when available", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-runtime-ws-"));
    const host = mockHostServices();
    (host as any).startTurnWebSocket = vi.fn(async () => ({ ok: true }));
    const runtime = createCodexTaskNerveHostRuntime({
      host,
      env: { TASKNERVE_MODEL_TRANSPORT: "auto" },
    });

    const result = await runtime.bootstrapControllerThread({
      repoRoot,
      projectName: "taskNerve",
      currentStateSignals: ["integration-first"],
      queueSummary: "0 open tasks",
      threadTitle: "TaskNerve Controller",
    });

    expect(result.model_transport.executed_mode).toBe("websocket");
    expect(result.model_transport.fell_back_to_http).toBe(false);
    expect((host as any).startTurnWebSocket).toHaveBeenCalledTimes(1);
    expect(host.startTurn).not.toHaveBeenCalled();
  });

  it("supports runtime transport override to force http on websocket-capable hosts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-runtime-http-"));
    const host = mockHostServices();
    (host as any).startTurnWebSocket = vi.fn(async () => ({ ok: true }));
    const runtime = createCodexTaskNerveHostRuntime({
      host,
      env: { TASKNERVE_MODEL_TRANSPORT: "auto" },
      modelTransportMode: "http",
    });

    const result = await runtime.bootstrapControllerThread({
      repoRoot,
      projectName: "taskNerve",
      currentStateSignals: ["integration-first"],
      queueSummary: "0 open tasks",
      threadTitle: "TaskNerve Controller",
    });

    expect(result.model_transport.requested_mode).toBe("http");
    expect(result.model_transport.resolved_mode).toBe("http");
    expect(result.model_transport.executed_mode).toBe("http");
    expect((host as any).startTurnWebSocket).not.toHaveBeenCalled();
    expect(host.startTurn).toHaveBeenCalledTimes(1);
  });

  it("exposes model transport snapshot for diagnostics", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({
      host,
      env: { TASKNERVE_MODEL_TRANSPORT: "websocket" },
    });

    const snapshot = runtime.modelTransportSnapshot();
    expect(snapshot.integration_mode).toBe("codex-native-host");
    expect(snapshot.requested_mode).toBe("websocket");
    expect(snapshot.resolved_mode).toBe("http");
    expect(snapshot.websocket_available).toBe(false);
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

  it("dedupes concurrent smart git sync runs per repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-dedupe-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 25);
        }),
    );
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const [first, second] = await Promise.all([
      runtime.syncProjectGit({
        repoRoot,
        tasks: [
          { task_id: "t1", title: "done one", status: "done" },
          { task_id: "t2", title: "done two", status: "done" },
          { task_id: "t3", title: "done three", status: "done" },
          { task_id: "t4", title: "done four", status: "done" },
        ],
        mode: "smart",
      }),
      runtime.syncProjectGit({
        repoRoot,
        tasks: [
          { task_id: "t1", title: "done one", status: "done" },
          { task_id: "t2", title: "done two", status: "done" },
          { task_id: "t3", title: "done three", status: "done" },
          { task_id: "t4", title: "done four", status: "done" },
        ],
        mode: "smart",
      }),
    ]);

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(host.pullRepository).toHaveBeenCalledTimes(1);
    expect(host.pushRepository).toHaveBeenCalledTimes(1);
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

  it("escalates git pull failures to a controller remediation task automatically", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-pull-failure-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectGit({
      repoRoot,
      mode: "pull",
      nowIsoUtc: "2026-03-11T04:13:00.000Z",
    });

    expect(result.executed.pull).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Pull failed: network unavailable")]),
    );
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: [
        expect.objectContaining({
          task_id: "task.git-remediation.controller",
          claimed_by_agent_id: "agent.controller",
          subsystem: "git-sync",
        }),
      ],
    });
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot,
      task_ids: ["task.git-remediation.controller"],
    });
  });

  it("escalates smart push-blocked git policy states to controller remediation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-push-blocked-"));
    const host = mockHostServices();
    host.readRepositoryGitState = vi.fn(async () => ({
      branch: "tasknerve/main",
      remote: "",
      ahead_count: 3,
      behind_count: 0,
      changed_file_count: 0,
      staged_file_count: 0,
      untracked_file_count: 0,
      clean: true,
    }));
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const service = createTaskNerveService();
    await service.writeProjectSettings(repoRoot, {
      git_tasks_per_push_target: 1,
      git_done_task_count_at_last_push: 0,
    });

    const result = await runtime.syncProjectGit({
      repoRoot,
      tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      mode: "smart",
      nowIsoUtc: "2026-03-11T04:13:30.000Z",
    });

    expect(result.plan_reason).toBe("smart-push-blocked");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Git sync blocked: missing-remote")]),
    );
    expect(host.pullRepository).not.toHaveBeenCalled();
    expect(host.pushRepository).not.toHaveBeenCalled();
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: [
        expect.objectContaining({
          task_id: "task.git-remediation.controller",
        }),
      ],
    });
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot,
      task_ids: ["task.git-remediation.controller"],
    });
  });

  it("does not re-dispatch unchanged active git remediation tasks", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-git-sync-remediation-dedupe-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(async () => {
      throw new Error("fetch timeout");
    });
    const runtime = createCodexTaskNerveHostRuntime({ host });

    await runtime.syncProjectGit({
      repoRoot,
      mode: "pull",
      nowIsoUtc: "2026-03-11T04:14:00.000Z",
    });
    const firstTask =
      (host.upsertTaskNerveProjectTasks as any).mock.calls?.[0]?.[0]?.tasks?.[0] ?? null;
    expect(firstTask).toBeTruthy();

    (host.upsertTaskNerveProjectTasks as any).mockClear();
    (host.dispatchTaskNerveTasks as any).mockClear();

    const second = await runtime.syncProjectGit({
      repoRoot,
      mode: "pull",
      tasks: [firstTask],
      nowIsoUtc: "2026-03-11T04:14:30.000Z",
    });

    expect(second.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Git remediation is already active for the current issue fingerprint"),
      ]),
    );
    expect(host.upsertTaskNerveProjectTasks).not.toHaveBeenCalled();
    expect(host.dispatchTaskNerveTasks).not.toHaveBeenCalled();
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

  it("blocks CI dispatch when the assignee already has unfinished work", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-sync-completion-gate-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectCi({
      repoRoot,
      tasks: [
        {
          task_id: "task-active-agent-ci",
          title: "Active worker task",
          status: "claimed",
          claimed_by_agent_id: "agent.ci",
        },
      ],
      availableAgentIds: ["agent.ci"],
      nowIsoUtc: "2026-03-11T04:06:30.000Z",
    });

    expect(result.persisted_task_upserts).toBe(1);
    expect(result.dispatched_task_ids).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Task completion gate blocked")]),
    );
    expect(host.dispatchTaskNerveTasks).not.toHaveBeenCalled();
  });

  it("dedupes concurrent CI sync runs per repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-ci-sync-dedupe-"));
    const host = mockHostServices();
    host.upsertTaskNerveProjectTasks = vi.fn(
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 25);
        }),
    );
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const [first, second] = await Promise.all([
      runtime.syncProjectCi({
        repoRoot,
        tasks: [],
      }),
      runtime.syncProjectCi({
        repoRoot,
        tasks: [],
      }),
    ]);

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledTimes(1);
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledTimes(1);
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

  it("syncs project traces into taskNerve/project_trace.ndjson via host thread listing", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-runtime-trace-sync-"));
    const host = mockHostServices();
    (host as any).listProjectThreads = vi.fn(async () => ({
      threads: [
        {
          thread_id: "thread-controller",
          role: "controller",
          agent_id: "agent.controller",
          title: "TaskNerve Controller",
          turns: [
            {
              id: "turn-1",
              role: "assistant",
              text: "Controller trace output.",
            },
          ],
        },
      ],
    }));
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectTrace({
      repoRoot,
      projectName: "taskNerve",
      nowIsoUtc: "2026-03-11T04:09:30.000Z",
    });

    expect(result.integration_mode).toBe("codex-native-host");
    expect(result.enabled).toBe(true);
    expect(result.entries_appended).toBe(2);
    expect(host.listProjectThreads).toHaveBeenCalledTimes(1);
    const traceRaw = await readFile(result.trace_path, "utf8");
    expect(traceRaw).toContain("\"thread_id\":\"thread-controller\"");
  });

  it("resets stalled worker threads deterministically without controller escalation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-watchdog-worker-reset-"));
    const host = mockHostServices();
    host.startThread = vi
      .fn()
      .mockResolvedValueOnce({ thread_id: "thread-agent-recovery" })
      .mockResolvedValue({ thread_id: "thread-agent-recovery-2" });
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncAgentWatchdog({
      repoRoot,
      nowIsoUtc: "2026-03-12T16:00:00.000Z",
      tasks: [
        {
          task_id: "task-stalled-worker",
          title: "Implement parser",
          status: "claimed",
          claimed_by_agent_id: "agent.beta",
          objective: "Finish parser implementation",
          files_in_scope: ["src/parser.ts"],
          acceptance_criteria: ["Parser handles baseline input"],
          deliverables: ["Updated parser implementation"],
          verification_steps: ["Run parser unit test"],
        },
      ],
      settings: {
        worker_default_model: "gpt-5-codex",
      },
      threadsPayload: {
        threads: [
          {
            thread_id: "thread-agent-stalled",
            role: "agent",
            agent_id: "agent.beta",
            title: "agent.beta",
            created_at: "2026-03-12T15:00:00.000Z",
            updated_at: "2026-03-12T15:30:00.000Z",
            turns: [
              {
                id: "turn-1",
                role: "assistant",
                created_at: "2026-03-12T15:05:00.000Z",
                text: "Starting task.",
              },
              {
                id: "turn-2",
                role: "user",
                created_at: "2026-03-12T15:30:00.000Z",
                text: "Any progress?",
              },
            ],
          },
        ],
      },
    });

    expect(result.worker_resets).toBe(1);
    expect(result.controller_resets).toBe(0);
    expect(result.recovered_task_ids).toContain("task-stalled-worker");
    expect(host.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "agent",
        agent_id: "agent.beta",
      }),
    );
    expect(host.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: "thread-agent-recovery",
        agent_id: "agent.beta",
      }),
    );
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: [
        expect.objectContaining({
          task_id: "task-stalled-worker",
          claimed_by_agent_id: "agent.beta",
          status: "claimed",
        }),
      ],
    });
    expect(host.dispatchTaskNerveTasks).not.toHaveBeenCalled();
  });

  it("resets stalled controller thread directly instead of escalating", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-watchdog-controller-reset-"));
    const host = mockHostServices();
    host.startThread = vi.fn(async () => ({ thread_id: "thread-controller-recovery" }));
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncAgentWatchdog({
      repoRoot,
      nowIsoUtc: "2026-03-12T16:00:00.000Z",
      settings: {
        controller_default_model: "gpt-5-codex-controller",
      },
      threadsPayload: {
        threads: [
          {
            thread_id: "thread-controller-stalled",
            role: "controller",
            agent_id: "agent.controller",
            title: "TaskNerve Controller",
            status: "running",
            created_at: "2026-03-12T14:30:00.000Z",
            updated_at: "2026-03-12T15:20:00.000Z",
            turns: [
              {
                id: "turn-1",
                role: "user",
                created_at: "2026-03-12T15:20:00.000Z",
                text: "Keep coordinating tasks",
              },
            ],
          },
        ],
      },
    });

    expect(result.worker_resets).toBe(0);
    expect(result.controller_resets).toBe(1);
    expect(host.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "controller",
        agent_id: "agent.controller",
      }),
    );
    expect(host.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: "thread-controller-recovery",
        agent_id: "agent.controller",
      }),
    );
    expect(host.upsertTaskNerveProjectTasks).not.toHaveBeenCalled();
    expect(host.dispatchTaskNerveTasks).not.toHaveBeenCalled();
  });

  it("suppresses worker reset during deterministic waiting-hint grace windows", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-watchdog-wait-hint-grace-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncAgentWatchdog({
      repoRoot,
      nowIsoUtc: "2026-03-12T16:00:00.000Z",
      tasks: [
        {
          task_id: "task-monitor-training",
          title: "Monitor model training run",
          status: "claimed",
          claimed_by_agent_id: "agent.beta",
        },
      ],
      threadsPayload: {
        threads: [
          {
            thread_id: "thread-agent-monitoring",
            role: "agent",
            agent_id: "agent.beta",
            title: "agent.beta",
            status: "running",
            created_at: "2026-03-12T15:00:00.000Z",
            updated_at: "2026-03-12T15:20:00.000Z",
            turns: [
              {
                id: "turn-1",
                role: "assistant",
                created_at: "2026-03-12T15:00:00.000Z",
                text: "Starting training monitor task.",
              },
              {
                id: "turn-2",
                role: "assistant",
                created_at: "2026-03-12T15:20:00.000Z",
                text: "Monitoring training run now. This may take 30 minutes, I will update when complete.",
              },
            ],
          },
        ],
      },
    });

    expect(result.worker_resets).toBe(0);
    expect(result.stalled_worker_candidates).toBe(0);
    expect(result.controller_resets).toBe(0);
    expect(host.startThread).not.toHaveBeenCalled();
    expect(host.startTurn).not.toHaveBeenCalled();
    expect(host.upsertTaskNerveProjectTasks).not.toHaveBeenCalled();
  });

  it("extends watchdog waiting grace from declared long-run duration", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "tasknerve-watchdog-wait-hint-duration-grace-"),
    );
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncAgentWatchdog({
      repoRoot,
      nowIsoUtc: "2026-03-12T16:00:00.000Z",
      tasks: [
        {
          task_id: "task-monitor-long-eval",
          title: "Monitor long evaluation run",
          status: "claimed",
          claimed_by_agent_id: "agent.gamma",
        },
      ],
      threadsPayload: {
        threads: [
          {
            thread_id: "thread-agent-long-eval",
            role: "agent",
            agent_id: "agent.gamma",
            title: "agent.gamma",
            status: "running",
            created_at: "2026-03-12T12:00:00.000Z",
            updated_at: "2026-03-12T13:55:00.000Z",
            turns: [
              {
                id: "turn-1",
                role: "assistant",
                created_at: "2026-03-12T12:05:00.000Z",
                text: "Starting evaluation monitor task.",
              },
              {
                id: "turn-2",
                role: "assistant",
                created_at: "2026-03-12T13:55:00.000Z",
                text: "Monitoring evaluation pipeline now. This may take 3 hours; I will update when complete.",
              },
            ],
          },
        ],
      },
    });

    expect(result.worker_resets).toBe(0);
    expect(result.stalled_worker_candidates).toBe(0);
    expect(result.controller_resets).toBe(0);
    expect(host.startThread).not.toHaveBeenCalled();
    expect(host.startTurn).not.toHaveBeenCalled();
    expect(host.upsertTaskNerveProjectTasks).not.toHaveBeenCalled();
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
    expect(result.executed.watchdog_worker_resets).toBe(0);
    expect(result.executed.watchdog_controller_resets).toBe(0);
    expect(result.timings_ms.total).toBeGreaterThanOrEqual(0);
    expect(result.watchdog.integration_mode).toBe("codex-native-host");
    expect(result.trace_sync.integration_mode).toBe("codex-native-host");
    expect(result.trace_sync.trace_path).toContain("/taskNerve/project_trace.ndjson");
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

  it("dedupes concurrent smart production sync runs per repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-production-sync-dedupe-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 25);
        }),
    );
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const service = createTaskNerveService();
    await service.writeProjectSettings(repoRoot, {
      git_tasks_per_push_target: 1,
      git_done_task_count_at_last_push: 0,
    });

    const [first, second] = await Promise.all([
      runtime.syncProjectProduction({
        repoRoot,
        tasks: [{ task_id: "t1", title: "done one", status: "done" }],
        mode: "smart",
      }),
      runtime.syncProjectProduction({
        repoRoot,
        tasks: [{ task_id: "t1", title: "done one", status: "done" }],
        mode: "smart",
      }),
    ]);

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(host.pullRepository).toHaveBeenCalledTimes(1);
    expect(host.pushRepository).toHaveBeenCalledTimes(1);
  });

  it("reuses short-lived trace sync cache for burst refreshes and supports force refresh", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-trace-sync-cache-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const first = await runtime.syncProjectTrace({ repoRoot });
    const second = await runtime.syncProjectTrace({ repoRoot });
    const forced = await runtime.syncProjectTrace({ repoRoot, force: true });

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(forced.integration_mode).toBe("codex-native-host");
    expect(host.listProjectThreads).toHaveBeenCalledTimes(2);
  });

  it("de-dupes concurrent forced trace sync runs for the same repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-trace-sync-force-dedupe-"));
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const [first, second] = await Promise.all([
      runtime.syncProjectTrace({ repoRoot, force: true }),
      runtime.syncProjectTrace({ repoRoot, force: true }),
    ]);

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(host.listProjectThreads).toHaveBeenCalledTimes(1);
  });

  it("escalates production git pull failures through controller remediation automation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-production-git-remediation-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(async () => {
      throw new Error("remote rejected");
    });
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const result = await runtime.syncProjectProduction({
      repoRoot,
      mode: "pull",
      persistCiTasks: false,
      dispatchCiTasks: false,
      nowIsoUtc: "2026-03-11T04:10:30.000Z",
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Pull failed: remote rejected")]),
    );
    expect(host.upsertTaskNerveProjectTasks).toHaveBeenCalledWith({
      repoRoot,
      tasks: [
        expect.objectContaining({
          task_id: "task.git-remediation.controller",
          claimed_by_agent_id: "agent.controller",
        }),
      ],
    });
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot,
      task_ids: ["task.git-remediation.controller"],
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
    expect(result.trace_sync.integration_mode).toBe("codex-native-host");
    expect(host.pullRepository).toHaveBeenCalledWith({
      repoRoot,
      autostash: true,
    });
  });

  it("dedupes concurrent controller automation runs per repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-controller-auto-dedupe-"));
    const host = mockHostServices();
    host.pullRepository = vi.fn(
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 25);
        }),
    );
    const runtime = createCodexTaskNerveHostRuntime({ host });
    const service = createTaskNerveService();
    await service.writeProjectSettings(repoRoot, {
      git_tasks_per_push_target: 1,
      git_done_task_count_at_last_push: 0,
    });

    const [first, second] = await Promise.all([
      runtime.controllerProjectAutomation({
        repoRoot,
        gitOriginUrl: "git@github.com:acme/tasknerve.git",
        tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      }),
      runtime.controllerProjectAutomation({
        repoRoot,
        gitOriginUrl: "git@github.com:acme/tasknerve.git",
        tasks: [{ task_id: "t1", title: "done one", status: "done" }],
      }),
    ]);

    expect(first.integration_mode).toBe("codex-native-host");
    expect(second.integration_mode).toBe("codex-native-host");
    expect(host.pullRepository).toHaveBeenCalledTimes(1);
    expect(host.pushRepository).toHaveBeenCalledTimes(1);
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
    expect(result.trace_sync.integration_mode).toBe("codex-native-host");
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
      type: "scroll-to-top",
      scrollTopPx: 264,
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
    expect(host.scrollConversationToTop).toHaveBeenCalledWith(264, {
      behavior: "smooth",
    });
    expect(host.setConversationCurrentTurnKey.mock.invocationCallOrder[0]).toBeLessThan(
      host.scrollConversationToTop.mock.invocationCallOrder[0],
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
    expect(snapshot.topbar.sidebarCollapsedProjectActions.importProjectButton.action).toBe(
      "topbar-import-project-click",
    );
    expect(snapshot.topbar.sidebarCollapsedProjectActions.newProjectButton.action).toBe(
      "topbar-new-project-click",
    );

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

  it("routes collapsed topbar project actions through native host project methods", async () => {
    const host = mockHostServices();
    const runtime = createCodexTaskNerveHostRuntime({ host });

    const importResult = await runtime.handleConversationChromeAction({
      type: "topbar-import-project-click",
    });
    expect(importResult.ok).toBe(true);
    expect(host.addWorkspaceRootOption).toHaveBeenCalledWith({
      mode: "import-existing",
    });

    const newResult = await runtime.handleConversationChromeAction({
      type: "topbar-new-project-click",
    });
    expect(newResult.ok).toBe(true);
    expect(host.addWorkspaceRootOption).toHaveBeenLastCalledWith({
      mode: "new-project",
    });
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
