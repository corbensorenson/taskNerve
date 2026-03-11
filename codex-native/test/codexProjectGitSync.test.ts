import { describe, expect, it } from "vitest";

import {
  buildCodexProjectGitSyncSnapshot,
  planCodexProjectGitSync,
} from "../src/integration/codexProjectGitSync.js";

describe("codex project git sync", () => {
  it("normalizes host git state and exposes push cadence metrics", () => {
    const snapshot = buildCodexProjectGitSyncSnapshot({
      settings: {
        git_auto_sync_enabled: true,
        git_tasks_per_push_target: 4,
        git_done_task_count_at_last_push: 0,
        git_tasks_before_push_history: [2, 5, 3],
      },
      tasks: [
        { task_id: "t1", title: "done 1", status: "done" },
        { task_id: "t2", title: "done 2", status: "done" },
        { task_id: "t3", title: "done 3", status: "done" },
        { task_id: "t4", title: "done 4", status: "done" },
      ],
      git_state: {
        current_branch: "tasknerve/main",
        remote: "origin",
        aheadCount: 3,
        behind_count: 1,
        changedFileCount: 0,
        staged_file_count: 0,
        untrackedFileCount: 0,
      },
      now_iso: "2026-03-11T04:00:00.000Z",
    });

    expect(snapshot.repository.branch).toBe("tasknerve/main");
    expect(snapshot.task_metrics.average_tasks_before_push).toBe(3.33);
    expect(snapshot.recommendation.action).toBe("pull-then-push");
  });

  it("builds explicit execution plans from smart recommendation", () => {
    const plan = planCodexProjectGitSync({
      snapshot: buildCodexProjectGitSyncSnapshot({
        settings: {
          git_auto_sync_enabled: true,
          git_tasks_per_push_target: 2,
          git_done_task_count_at_last_push: 0,
        },
        tasks: [
          { task_id: "t1", title: "done 1", status: "done" },
          { task_id: "t2", title: "done 2", status: "done" },
        ],
        git_state: {
          branch: "tasknerve/main",
          remote: "origin",
          ahead_count: 1,
          behind_count: 0,
          clean: true,
        },
      }),
    });

    expect(plan.reason).toBe("smart-push");
    expect(plan.should_pull).toBe(false);
    expect(plan.should_push).toBe(true);
  });

  it("blocks smart push when branch policy disallows current branch", () => {
    const snapshot = buildCodexProjectGitSyncSnapshot({
      settings: {
        git_auto_sync_enabled: true,
        git_tasks_per_push_target: 1,
        git_done_task_count_at_last_push: 0,
        git_auto_sync_allowed_branches: ["tasknerve/main"],
      },
      tasks: [{ task_id: "t1", title: "done 1", status: "done" }],
      git_state: {
        branch: "feature/perf",
        remote: "origin",
        ahead_count: 1,
        behind_count: 0,
        clean: true,
      },
    });

    const plan = planCodexProjectGitSync({
      snapshot,
    });

    expect(snapshot.recommendation.reason).toBe("push-blocked");
    expect(snapshot.recommendation.push_blocked_reason).toBe("branch-not-allowed");
    expect(plan.reason).toBe("smart-push-blocked");
    expect(plan.should_push).toBe(false);
  });
});
