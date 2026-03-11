import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTaskNerveService } from "../src/integration/taskNerveService.js";
import type { TaskRecord } from "../src/schemas.js";

describe("taskNerve service integration surface", () => {
  it("reports integration health and core capabilities", () => {
    const service = createTaskNerveService();
    const health = service.health();

    expect(health.ok).toBe(true);
    expect(health.mode).toBe("codex-native-integration");
    expect(health.capabilities).toContain("project_settings");
    expect(health.capabilities).toContain("task_snapshot");
    expect(health.capabilities).toContain("conversation_display");
    expect(health.capabilities).toContain("conversation_interaction");
    expect(health.capabilities).toContain("project_git_sync");
    expect(health.capabilities).toContain("thread_display");
  });

  it("builds project contracts and task snapshots without HTTP bridge glue", () => {
    const service = createTaskNerveService();
    const contracts = service.renderProjectContracts({
      repoName: "taskNerve",
      repoRoot: "/tmp/taskNerve",
      languages: ["TypeScript"],
      toolchains: ["npm"],
    });

    expect(contracts.project_goals).toMatch(/# Project Goals/);
    expect(contracts.project_manifest).toMatch(/# Project Manifest/);

    const snapshot = service.taskSnapshot(
      [
        { task_id: "t-2", title: "done", status: "done", priority: 5, tags: ["model:gpt-5-codex"] },
        { task_id: "t-1", title: "open", status: "open", priority: 10, tags: ["native", "intelligence:high"] },
      ],
      "open",
    );

    expect(snapshot.visible_tasks).toHaveLength(1);
    expect(snapshot.visible_tasks[0]?.task_id).toBe("t-1");
    expect(snapshot.all_stats.total).toBe(2);
    expect(snapshot.user_tags).toEqual(["native"]);
  });

  it("reuses task snapshot objects for unchanged task/search inputs", () => {
    const service = createTaskNerveService();
    const tasks: Array<Partial<TaskRecord>> = [
      { task_id: "t-2", title: "done", status: "done", priority: 5 },
      { task_id: "t-1", title: "open", status: "open", priority: 10 },
    ];
    const first = service.taskSnapshot(tasks, "open");
    const second = service.taskSnapshot(tasks, "open");
    const third = service.taskSnapshot(tasks, "");

    expect(second).toBe(first);
    expect(third.all_tasks).toBe(first.all_tasks);
    expect(third.user_tags).toBe(first.user_tags);
  });

  it("reuses task snapshot objects for content-equivalent cloned task arrays", () => {
    const service = createTaskNerveService();
    const tasks: Array<Partial<TaskRecord>> = [
      { task_id: "t-2", title: "done", status: "done", priority: 5, tags: ["x"] },
      { task_id: "t-1", title: "open", status: "open", priority: 10, tags: ["y"] },
    ];
    const first = service.taskSnapshot(tasks, "open");
    const cloned = tasks.map((task) => ({ ...task, tags: [...(task.tags || [])] }));
    const second = service.taskSnapshot(cloned, "open");

    expect(second).toBe(first);
    expect(second.all_tasks).toBe(first.all_tasks);
    expect(second.visible_tasks).toBe(first.visible_tasks);
  });

  it("filters task snapshots by claimed agent, tags, and dependencies", () => {
    const service = createTaskNerveService();
    const tasks: Array<Partial<TaskRecord>> = [
      {
        task_id: "t-1",
        title: "wire telemetry",
        status: "open",
        priority: 10,
        claimed_by_agent_id: "agent.alpha",
        tags: ["ops", "telemetry"],
        depends_on: ["bootstrap-core"],
      },
      {
        task_id: "t-2",
        title: "navigation perf",
        status: "open",
        priority: 9,
        claimed_by_agent_id: "agent.beta",
        tags: ["ui", "perf-hotpath"],
        depends_on: ["thread-display-cache"],
      },
    ];

    const byClaimedAgent = service.taskSnapshot(tasks, "agent.beta");
    const byTag = service.taskSnapshot(tasks, "perf-hotpath");
    const byDependency = service.taskSnapshot(tasks, "bootstrap-core");

    expect(byClaimedAgent.visible_tasks.map((task) => task.task_id)).toEqual(["t-2"]);
    expect(byTag.visible_tasks.map((task) => task.task_id)).toEqual(["t-2"]);
    expect(byDependency.visible_tasks.map((task) => task.task_id)).toEqual(["t-1"]);
  });

  it("reuses normalized search results for equivalent query text", () => {
    const service = createTaskNerveService();
    const tasks: Array<Partial<TaskRecord>> = [
      { task_id: "t-1", title: "Open item", status: "open", priority: 10 },
      { task_id: "t-2", title: "Closed item", status: "done", priority: 1 },
    ];

    const first = service.taskSnapshot(tasks, "open");
    const second = service.taskSnapshot(tasks, "  OPEN  ");

    expect(second).not.toBe(first);
    expect(second.search).toBe("  OPEN  ");
    expect(second.visible_tasks).toBe(first.visible_tasks);
    expect(second.visible_stats).toBe(first.visible_stats);
  });

  it("does not reuse snapshots when quick task markers match but interior tasks changed", () => {
    const service = createTaskNerveService();
    const tasks: Array<Partial<TaskRecord>> = [
      { task_id: "t-1", title: "a", status: "open", priority: 10, tags: ["x"] },
      { task_id: "t-2", title: "b", status: "open", priority: 9, tags: ["x"] },
      { task_id: "t-3", title: "c", status: "open", priority: 8, tags: ["x"] },
      { task_id: "t-4", title: "d", status: "open", priority: 7, tags: ["x"] },
      { task_id: "t-5", title: "e", status: "open", priority: 6, tags: ["x"] },
    ];
    const first = service.taskSnapshot(tasks, "probe");

    const changedInterior = tasks.map((task, index) =>
      index === 1 ? { ...task, title: "probe task" } : { ...task },
    );
    const second = service.taskSnapshot(changedInterior, "probe");

    expect(second).not.toBe(first);
    expect(second.visible_tasks.map((task) => task.task_id)).toEqual(["t-2"]);
  });

  it("resolves model routing and queue behavior via direct service calls", () => {
    const service = createTaskNerveService();

    const models = service.resolveModelsForTask(
      {
        controller_default_model: "gpt-5-codex-controller",
        worker_model_routing_enabled: true,
        worker_default_model: "gpt-5-codex-medium",
        high_intelligence_model: "gpt-5-codex-high",
      },
      { suggested_intelligence: "high" },
    );

    expect(models.controller_model).toBe("gpt-5-codex-controller");
    expect(models.worker_model).toBe("gpt-5-codex-high");

    const queued = service.queuePrompt(
      [{ agent_id: "agent.1", thread_id: "th-1", prompt_id: "old", status: "pending" }],
      { agent_id: "agent.1", thread_id: "th-1", prompt_id: "new", status: "pending" },
    );

    expect(queued.replaced_pending).toBe(true);
    expect(queued.queue.map((entry) => entry.prompt_id)).toEqual(["new"]);
  });

  it("builds thread display snapshots with timestamps, prompt navigation, and non-janky scroll policy", () => {
    const service = createTaskNerveService();
    const thread = {
      conversation: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T15:00:00.000Z",
            input_items: [{ type: "message", text: "First prompt" }],
            output_items: [{ type: "message", text: "First answer" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T15:01:00.000Z",
            input_items: [{ type: "message", text: "Second prompt" }],
            output_items: [
              { type: "tool_call", name: "exec_command", detail: "ls -la" },
              { type: "message", text: "Second answer" },
            ],
          },
        ],
      },
    };

    const snapshot = service.threadDisplaySnapshot({
      thread,
      current_turn_key: "assistant:turn-1",
      previous_entry_count: 2,
      previous_viewport: {
        scroll_top_px: 220,
        scroll_height_px: 1000,
        viewport_height_px: 500,
      },
      viewport: {
        scroll_top_px: 220,
        scroll_height_px: 1300,
        viewport_height_px: 500,
      },
    });

    expect(snapshot.entries.length).toBe(5);
    expect(snapshot.entries.every((entry) => entry.timestamp_label.length > 0)).toBe(true);
    expect(snapshot.entries.every((entry) => entry.timestamp_tooltip.length > 0)).toBe(true);

    const toolEntry = snapshot.entries.find((entry) => entry.text.includes("exec_command"));
    expect(toolEntry?.kind).toBe("action");

    expect(snapshot.prompt_navigation.previous_turn_key).toBe(null);
    expect(snapshot.prompt_navigation.next_turn_key).toBe("user:turn-2");

    expect(snapshot.scroll_decision.mode).toBe("no-op");
    expect(snapshot.jump_controls.placement).toBe("left-of-send-voice");
    expect(snapshot.jump_controls.up_action).toBe("jump-prev-user-message");
    expect(snapshot.jump_controls.down_action).toBe("jump-next-user-message");
  });

  it("builds Codex-style conversation display snapshots with camelCase API", () => {
    const service = createTaskNerveService();
    const snapshot = service.conversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T11:00:00.000Z",
            input_items: [{ type: "message", text: "ping" }],
            output_items: [{ type: "message", text: "pong" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 260,
        viewport_height_px: 200,
      },
    });

    expect(snapshot.integrationMode).toBe("codex-native-host");
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.promptNavigation.userTurnKeys).toEqual(["user:turn-1"]);
    expect(snapshot.virtualWindow.end_index_exclusive).toBe(2);
  });

  it("builds conversation interaction commands for jump controls", () => {
    const service = createTaskNerveService();
    const snapshot = service.conversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T11:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T11:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
          {
            id: "turn-3",
            created_at: "2026-03-10T11:02:00.000Z",
            input_items: [{ type: "message", text: "three" }],
            output_items: [{ type: "message", text: "c" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-2",
    });

    const interaction = service.conversationInteractionStep({
      snapshot,
      event: {
        type: "jump-next-user-message",
        nowMs: 1000,
      },
    });

    expect(interaction.integrationMode).toBe("codex-native-host");
    expect(interaction.commands).toHaveLength(2);
    expect(interaction.commands[0]).toMatchObject({
      type: "set-current-turn-key",
      turnKey: "user:turn-3",
    });
    expect(interaction.commands[1]).toMatchObject({
      type: "scroll-to-turn",
      turnKey: "user:turn-3",
      behavior: "smooth",
    });
  });

  it("builds git sync snapshots with average tasks-before-push metrics", () => {
    const service = createTaskNerveService();
    const snapshot = service.projectGitSyncSnapshot({
      settings: {
        git_auto_sync_enabled: true,
        git_tasks_per_push_target: 3,
        git_done_task_count_at_last_push: 1,
        git_tasks_before_push_history: [2, 4, 3],
      },
      tasks: [
        { task_id: "t1", title: "done 1", status: "done" },
        { task_id: "t2", title: "done 2", status: "done" },
        { task_id: "t3", title: "done 3", status: "done" },
      ],
      git_state: {
        branch: "tasknerve/main",
        ahead_count: 2,
        behind_count: 0,
        clean: true,
      },
      now_iso: "2026-03-11T04:00:00.000Z",
    });

    expect(snapshot.task_metrics.done_tasks_since_last_push).toBe(2);
    expect(snapshot.task_metrics.average_tasks_before_push).toBe(3);
    expect(snapshot.recommendation.action).toBe("no-op");
  });

  it("records push tracking in project settings after successful push", () => {
    const service = createTaskNerveService();
    const next = service.projectSettingsAfterGitPush({
      settings: {
        git_done_task_count_at_last_push: 1,
        git_tasks_before_push_history: [2, 3],
      },
      tasks: [
        { task_id: "t1", title: "done 1", status: "done" },
        { task_id: "t2", title: "done 2", status: "done" },
        { task_id: "t3", title: "done 3", status: "done" },
      ],
      pushed_at_utc: "2026-03-11T04:05:00.000Z",
    });

    expect(next.git_done_task_count_at_last_push).toBe(3);
    expect(next.git_last_push_at_utc).toBe("2026-03-11T04:05:00.000Z");
    expect(next.git_tasks_before_push_history).toEqual([2, 3, 2]);
  });

  it("loads and writes project settings and registry through the shared IO stores", async () => {
    const service = createTaskNerveService();
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-service-repo-"));
    const taskNerveHome = await mkdtemp(path.join(os.tmpdir(), "tasknerve-service-home-"));
    const env = { ...process.env, TASKNERVE_HOME: taskNerveHome };

    const settings = await service.loadProjectSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/tasknerve.git",
    });

    expect(settings.git_origin_url).toBe("git@github.com:acme/tasknerve.git");

    const writtenSettings = await service.writeProjectSettings(repoRoot, {
      ...settings,
      controller_default_model: "gpt-5-codex-controller",
    });

    expect(writtenSettings.controller_default_model).toBe("gpt-5-codex-controller");

    const registry = await service.loadRegistry(env);
    const updatedRegistry = await service.writeRegistry(
      {
        ...registry,
        projects: [
          {
            name: "taskNerve",
            repo_root: repoRoot,
            added_at_utc: "2026-03-10T00:00:00.000Z",
            updated_at_utc: "2026-03-10T00:00:00.000Z",
            last_activity_at_utc: null,
            last_opened_at_utc: null,
          },
        ],
      },
      env,
    );

    expect(updatedRegistry.projects[0]?.name).toBe("taskNerve");
  });
});
