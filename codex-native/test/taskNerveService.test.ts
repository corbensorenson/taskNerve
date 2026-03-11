import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTaskNerveService } from "../src/integration/taskNerveService.js";

describe("taskNerve service integration surface", () => {
  it("reports integration health and core capabilities", () => {
    const service = createTaskNerveService();
    const health = service.health();

    expect(health.ok).toBe(true);
    expect(health.mode).toBe("codex-native-integration");
    expect(health.capabilities).toContain("project_settings");
    expect(health.capabilities).toContain("task_snapshot");
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
        scroll_top_px: 120,
        scroll_height_px: 1000,
        viewport_height_px: 500,
      },
      viewport: {
        scroll_top_px: 120,
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

    expect(snapshot.scroll_decision.mode).toBe("preserve-offset");
    expect(snapshot.scroll_decision.scroll_top_px).toBe(420);
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
