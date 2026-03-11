import { describe, expect, it } from "vitest";

import { buildCodexProjectCiTaskSyncPlan } from "../src/integration/codexProjectCiSync.js";
import { buildCodexProjectGitSyncSnapshot } from "../src/integration/codexProjectGitSync.js";
import { buildCodexProjectProductionSnapshot } from "../src/integration/codexProjectProduction.js";

describe("codex project production snapshot", () => {
  it("surfaces combined git and CI bottlenecks", () => {
    const git = buildCodexProjectGitSyncSnapshot({
      settings: {
        git_auto_sync_enabled: true,
        git_tasks_per_push_target: 1,
        git_done_task_count_at_last_push: 0,
        git_preferred_branch: "tasknerve/main",
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
      now_iso: "2026-03-11T06:00:00.000Z",
    });
    const ci = buildCodexProjectCiTaskSyncPlan({
      settings: {
        ci_auto_task_enabled: false,
      },
      failures: [
        {
          provider: "github",
          pipeline: "build",
          job: "unit",
          branch: "feature/perf",
          status: "failed",
        },
      ],
      tasks: [],
      now_iso: "2026-03-11T06:00:00.000Z",
    });

    const snapshot = buildCodexProjectProductionSnapshot({ git, ci });
    const bottleneckIds = snapshot.bottlenecks.map((entry) => entry.id);

    expect(bottleneckIds).toContain("git-branch-mismatch");
    expect(bottleneckIds).toContain("git-push-blocked");
    expect(bottleneckIds).toContain("ci-failures-detected");
    expect(bottleneckIds).toContain("ci-auto-task-disabled");
  });

  it("returns no bottlenecks for healthy production state", () => {
    const git = buildCodexProjectGitSyncSnapshot({
      settings: {
        git_auto_sync_enabled: true,
        git_tasks_per_push_target: 4,
        git_done_task_count_at_last_push: 0,
      },
      tasks: [],
      git_state: {
        branch: "tasknerve/main",
        remote: "origin",
        ahead_count: 0,
        behind_count: 0,
        clean: true,
      },
      now_iso: "2026-03-11T06:01:00.000Z",
    });
    const ci = buildCodexProjectCiTaskSyncPlan({
      settings: {
        ci_auto_task_enabled: true,
      },
      failures: [],
      tasks: [],
      now_iso: "2026-03-11T06:01:00.000Z",
    });

    const snapshot = buildCodexProjectProductionSnapshot({ git, ci });

    expect(snapshot.bottlenecks).toHaveLength(0);
  });
});
