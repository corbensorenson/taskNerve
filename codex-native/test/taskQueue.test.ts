import { describe, expect, it } from "vitest";

import {
  buildProjectTaskStats,
  filterTasks,
  gateTaskDispatchByQuality,
  mergePromptQueue,
  scoreTaskQuality,
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
          objective: "Reduce idle overhead",
          task_type: "maintenance",
          subsystem: "runtime",
          tags: ["native", "rewrite"],
          depends_on: ["task-0"],
          files_in_scope: ["codex-native/src/integration"],
          out_of_scope: ["ui"],
          acceptance_criteria: ["No duplicate reads during refresh bursts"],
          deliverables: ["runtime patch", "tests"],
          verification_steps: ["npx vitest run"],
          implementation_notes: "Prefer event-driven updates.",
          risk_notes: ["Avoid regressions in chrome refresh"],
          estimated_effort: "s",
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

  it("filters using structured task template fields", () => {
    const tasks = filterTasks(
      [
        {
          task_id: "task-structured",
          title: "Tune trace sync",
          acceptance_criteria: ["Controller and agent traces are appended deterministically"],
          verification_steps: ["Check taskNerve/project_trace_manifest.json counters"],
          estimated_effort: "xs",
          status: "open",
          priority: 4,
        },
      ],
      "project_trace_manifest",
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_id).toBe("task-structured");
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

  it("scores controller task quality deterministically", () => {
    const highQuality = scoreTaskQuality({
      task_id: "task-high",
      title: "Improve thread render batching",
      objective: "Cut frame drops in long threads",
      acceptance_criteria: ["Scroll stays above 55 FPS"],
      deliverables: ["Code update", "Tests"],
      verification_steps: ["npm test"],
      files_in_scope: ["codex-native/src/integration/threadDisplay"],
      task_type: "maintenance",
      estimated_effort: "s",
      implementation_notes: "Prefer memoized snapshots",
      risk_notes: ["Avoid stale cache regressions"],
      subsystem: "thread-display",
      ready: true,
    });
    const lowQuality = scoreTaskQuality({
      task_id: "task-low",
      title: "Do thing",
    });

    expect(highQuality.score).toBe(100);
    expect(highQuality.passes).toBe(true);
    expect(highQuality.missing_required_fields).toEqual([]);

    expect(lowQuality.score).toBe(15);
    expect(lowQuality.passes).toBe(false);
    expect(lowQuality.missing_required_fields).toEqual([
      "objective",
      "acceptance_criteria",
      "deliverables",
      "verification_steps",
      "files_in_scope",
    ]);
  });

  it("blocks low-quality dispatch for controller tasks and exempts CI by default", () => {
    const qualityGate = gateTaskDispatchByQuality({
      taskIds: ["controller-low", "ci-low", "controller-high"],
      tasks: [
        {
          task_id: "controller-low",
          title: "Needs details",
          tags: ["controller"],
        },
        {
          task_id: "ci-low",
          title: "Fix CI",
          tags: ["ci"],
        },
        {
          task_id: "controller-high",
          title: "Optimize task drawer refresh",
          objective: "Reduce idle overhead from poll loops",
          acceptance_criteria: ["No duplicate host reads per second"],
          deliverables: ["Runtime patch"],
          verification_steps: ["npm test"],
          files_in_scope: ["codex-native/src/integration/codexConversationChrome.ts"],
          task_type: "maintenance",
          estimated_effort: "s",
          implementation_notes: "Prefer host subscriptions",
          risk_notes: ["Do not regress drawer state sync"],
          subsystem: "chrome",
          ready: true,
        },
      ],
      gate: {
        enabled: true,
        minScore: 80,
        includeCiTasks: false,
      },
    });

    expect(qualityGate.allowed_task_ids).toEqual(["ci-low", "controller-high"]);
    expect(qualityGate.blocked_task_ids).toEqual(["controller-low"]);
  });

  it("can enforce quality gate for CI-tagged tasks when configured", () => {
    const qualityGate = gateTaskDispatchByQuality({
      taskIds: ["ci-low"],
      tasks: [
        {
          task_id: "ci-low",
          title: "Fix CI",
          tags: ["ci"],
        },
      ],
      gate: {
        enabled: true,
        minScore: 80,
        includeCiTasks: true,
      },
    });

    expect(qualityGate.allowed_task_ids).toEqual([]);
    expect(qualityGate.blocked_task_ids).toEqual(["ci-low"]);
  });
});
