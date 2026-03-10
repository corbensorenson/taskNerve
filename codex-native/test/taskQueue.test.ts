import { describe, expect, it } from "vitest";

import {
  buildProjectTaskStats,
  filterTasks,
  mergePromptQueue,
  sortTasks,
  taskUserTags,
} from "../src/domain/taskQueue.js";

describe("task queue helpers", () => {
  it("sorts active work ahead of finished work", () => {
    const tasks = sortTasks([
      { task_id: "c", title: "done task", status: "done", priority: 99 },
      { task_id: "a", title: "low open", status: "open", priority: 1 },
      { task_id: "b", title: "high open", status: "open", priority: 10 },
      { task_id: "d", title: "claimed", status: "claimed", priority: 50 },
    ]);

    expect(tasks.map((task) => task.task_id)).toEqual(["b", "a", "d", "c"]);
  });

  it("filters using task metadata", () => {
    const tasks = filterTasks(
      [
        {
          task_id: "task-1",
          title: "Build native queue",
          detail: "Move orchestration into JS",
          tags: ["native", "rewrite"],
          depends_on: ["task-0"],
          claimed_by_agent_id: "agent.a",
          status: "open",
          priority: 10,
        },
        {
          task_id: "task-2",
          title: "Rust parity fix",
          detail: "Keep old service healthy",
          tags: ["legacy"],
          depends_on: [],
          status: "claimed",
          priority: 5,
        },
      ],
      "rewrite",
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_id).toBe("task-1");
  });

  it("counts task stats", () => {
    expect(
      buildProjectTaskStats([
        { status: "open", ready: true },
        { status: "claimed", ready: false },
        { status: "blocked", ready: false },
        { status: "done", ready: false },
      ]),
    ).toEqual({
      total: 4,
      open: 1,
      claimed: 1,
      blocked: 1,
      done: 1,
      ready: 1,
    });
  });

  it("collapses pending worker prompts in single-message mode", () => {
    const result = mergePromptQueue(
      [
        { agent_id: "agent.a", thread_id: "thread-1", prompt_id: "old-pending", status: "pending" },
        { agent_id: "agent.a", thread_id: "thread-1", prompt_id: "run-1", status: "running" },
        { agent_id: "agent.b", thread_id: "thread-2", prompt_id: "other", status: "pending" },
      ],
      { agent_id: "agent.a", thread_id: "thread-1", prompt_id: "latest", status: "pending" },
    );

    expect(result.replaced_pending).toBe(true);
    expect(result.running_inflight).toBe(true);
    expect(result.queue.map((entry) => entry.prompt_id)).toEqual(["run-1", "other", "latest"]);
  });

  it("hides intelligence and model tags from user-visible tags", () => {
    expect(
      taskUserTags({
        tags: ["compiler", "intelligence:high", "model:gpt-5-codex", "native"],
      }),
    ).toEqual(["compiler", "native"]);
  });
});
