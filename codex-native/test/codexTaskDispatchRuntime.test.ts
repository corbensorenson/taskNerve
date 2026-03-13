import { describe, expect, it, vi } from "vitest";

import { CONTROLLER_AGENT_ID } from "../src/constants.js";
import { dispatchTaskNerveTasksWithPolicy } from "../src/integration/codexTaskDispatchRuntime.js";
import { createTaskNerveService } from "../src/integration/taskNerveService.js";
import type { TaskRecord } from "../src/schemas.js";

function qualityTask(taskId: string, agentId: string | null): Partial<TaskRecord> {
  return {
    task_id: taskId,
    title: `Task ${taskId}`,
    objective: "Improve deterministic task dispatch behavior",
    acceptance_criteria: ["Dispatch policy is deterministic"],
    deliverables: ["Runtime update"],
    verification_steps: ["npx vitest run"],
    files_in_scope: ["codex-native/src/integration/codexTaskDispatchRuntime.ts"],
    task_type: "maintenance",
    estimated_effort: "s",
    implementation_notes: "Use one shared dispatch pipeline",
    risk_notes: ["Avoid duplicate dispatch"],
    subsystem: "task-runtime",
    ready: true,
    status: "claimed",
    claimed_by_agent_id: agentId,
  };
}

describe("codex unified task dispatcher", () => {
  it("dispatches quality-approved tasks through one runtime path", async () => {
    const host = {
      dispatchTaskNerveTasks: vi.fn(async () => ({ ok: true })),
    } as any;
    const taskNerve = createTaskNerveService();
    const candidate = qualityTask("task-a", "agent.alpha");

    const result = await dispatchTaskNerveTasksWithPolicy({
      host,
      taskNerve,
      repoRoot: "/tmp/repo",
      settings: {},
      taskIds: ["task-a"],
      projectTasks: [],
      candidateTasks: [candidate],
    });

    expect(result.dispatched_task_ids).toEqual(["task-a"]);
    expect(result.blocked_task_ids).toEqual([]);
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledWith({
      repoRoot: "/tmp/repo",
      task_ids: ["task-a"],
    });
  });

  it("blocks reassignment when an agent already has unfinished work", async () => {
    const host = {
      dispatchTaskNerveTasks: vi.fn(async () => ({ ok: true })),
    } as any;
    const taskNerve = createTaskNerveService();
    const active = qualityTask("task-active", "agent.alpha");
    const next = qualityTask("task-next", "agent.alpha");

    const result = await dispatchTaskNerveTasksWithPolicy({
      host,
      taskNerve,
      repoRoot: "/tmp/repo",
      settings: {},
      taskIds: ["task-next"],
      projectTasks: [active],
      candidateTasks: [next],
    });

    expect(result.dispatched_task_ids).toEqual([]);
    expect(result.blocked_by_assignment_task_ids).toEqual(["task-next"]);
    expect(result.continue_task_ids).toEqual(["task-active"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Task completion gate blocked 1 dispatch item"),
      ]),
    );
    expect(host.dispatchTaskNerveTasks).not.toHaveBeenCalled();
  });

  it("allows controller-assigned dispatches even when controller has active tasks", async () => {
    const host = {
      dispatchTaskNerveTasks: vi.fn(async () => ({ ok: true })),
    } as any;
    const taskNerve = createTaskNerveService();
    const activeController = qualityTask("task-controller-active", CONTROLLER_AGENT_ID);
    const nextController = qualityTask("task-controller-next", CONTROLLER_AGENT_ID);

    const result = await dispatchTaskNerveTasksWithPolicy({
      host,
      taskNerve,
      repoRoot: "/tmp/repo",
      settings: {},
      taskIds: ["task-controller-next"],
      projectTasks: [activeController],
      candidateTasks: [nextController],
      label: "git remediation",
    });

    expect(result.dispatched_task_ids).toEqual(["task-controller-next"]);
    expect(result.blocked_task_ids).toEqual([]);
    expect(host.dispatchTaskNerveTasks).toHaveBeenCalledTimes(1);
  });

  it("does not report tasks as dispatched when host dispatch is unavailable", async () => {
    const host = {} as any;
    const taskNerve = createTaskNerveService();
    const candidate = qualityTask("task-a", "agent.alpha");

    const result = await dispatchTaskNerveTasksWithPolicy({
      host,
      taskNerve,
      repoRoot: "/tmp/repo",
      settings: {},
      taskIds: ["task-a"],
      projectTasks: [],
      candidateTasks: [candidate],
    });

    expect(result.dispatched_task_ids).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("dispatchTaskNerveTasks is unavailable")]),
    );
  });
});
