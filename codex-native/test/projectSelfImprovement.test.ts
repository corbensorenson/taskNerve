import { describe, expect, it } from "vitest";

import {
  buildProjectSelfImprovementPlan,
  projectSettingsAfterSelfImprovementDispatch,
} from "../src/domain/projectSelfImprovement.js";

describe("project self improvement planner", () => {
  it("creates deterministic maintenance tasks from active runtime signals", () => {
    const plan = buildProjectSelfImprovementPlan({
      settings: {
        self_improvement_enabled: true,
        self_improvement_auto_dispatch_enabled: true,
        self_improvement_max_tasks_per_run: 3,
        self_improvement_open_task_limit: 8,
        self_improvement_dispatch_cooldown_minutes: 0,
      },
      warnings: ["Task quality gate blocked 2 dispatch item(s): t1, t2"],
      git_issues: [
        {
          key: "pull-failed",
          phase: "pull",
          summary: "TaskNerve pull operation failed",
          detail: "remote rejected",
        },
      ],
      watchdog: {
        worker_resets: 2,
        controller_resets: 1,
      },
      now_iso: "2026-03-12T12:00:00.000Z",
    });

    expect(plan.integration_mode).toBe("codex-native-host");
    expect(plan.task_upserts.length).toBe(3);
    expect(plan.task_upserts.every((entry) => entry.action === "create")).toBe(true);
    expect(plan.dispatch_task_ids.length).toBe(3);
    expect(plan.blocked_by_cooldown).toBe(false);
    expect(plan.signals.watchdog_reset_count).toBe(3);
    expect(plan.signals.quality_gate_block_warning_count).toBe(1);
    expect(plan.signals.git_issue_count).toBe(1);
    expect(plan.task_upserts.map((entry) => entry.task.task_id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^auto-improve-/),
        expect.stringMatching(/^auto-improve-/),
        expect.stringMatching(/^auto-improve-/),
      ]),
    );
  });

  it("reopens completed tasks but enforces cooldown for dispatch", () => {
    const plan = buildProjectSelfImprovementPlan({
      settings: {
        self_improvement_enabled: true,
        self_improvement_auto_dispatch_enabled: true,
        self_improvement_max_tasks_per_run: 2,
        self_improvement_open_task_limit: 4,
        self_improvement_dispatch_cooldown_minutes: 90,
        self_improvement_last_dispatch_at_utc: "2026-03-12T11:45:00.000Z",
      },
      tasks: [
        {
          task_id: "auto-improve-aaaaaaaa",
          title: "Old watchdog stabilization pass",
          status: "done",
          tags: ["tasknerve:auto-improve", "auto-improve-key:watchdog-resets"],
        },
      ],
      watchdog: {
        worker_resets: 1,
        controller_resets: 0,
      },
      now_iso: "2026-03-12T12:00:00.000Z",
    });

    expect(plan.task_upserts).toHaveLength(1);
    expect(plan.task_upserts[0]?.action).toBe("reopen");
    expect(plan.dispatch_task_ids).toEqual([]);
    expect(plan.blocked_by_cooldown).toBe(true);
    expect(plan.skipped_reason).toBe("dispatch-cooldown-active");
  });

  it("updates settings timestamp after successful self-improvement dispatch", () => {
    const settings = projectSettingsAfterSelfImprovementDispatch({
      settings: {
        self_improvement_last_dispatch_at_utc: null,
      },
      dispatched_task_count: 2,
      dispatched_at_utc: "2026-03-12T14:10:00.000Z",
    });
    expect(settings.self_improvement_last_dispatch_at_utc).toBe("2026-03-12T14:10:00.000Z");
  });
});
