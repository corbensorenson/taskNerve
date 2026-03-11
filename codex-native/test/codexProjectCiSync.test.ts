import { describe, expect, it } from "vitest";

import {
  buildCodexProjectCiTaskSyncPlan,
  buildProjectSettingsAfterCodexCiSync,
  parseCodexProjectCiFailures,
} from "../src/integration/codexProjectCiSync.js";

describe("codex project CI sync", () => {
  it("normalizes host CI payloads and creates project task upserts", () => {
    const plan = buildCodexProjectCiTaskSyncPlan({
      settings: {
        ci_auto_task_enabled: true,
        ci_failure_task_priority: 8,
      },
      failures: {
        runs: [
          {
            provider: "github",
            workflow_name: "build",
            job_name: "lint",
            conclusion: "failure",
            ref: "refs/heads/main",
            head_sha: "abc123",
            html_url: "https://ci.example/runs/1",
            id: "1",
            completed_at: "2026-03-11T05:00:00.000Z",
          },
        ],
      },
      tasks: [],
      available_agent_ids: ["agent.ci"],
      now_iso: "2026-03-11T05:01:00.000Z",
    });

    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]?.branch).toBe("main");
    expect(plan.ci_metrics.task_upsert_count).toBe(1);
    expect(plan.task_upserts[0]?.task.status).toBe("claimed");
    expect(plan.task_upserts[0]?.task.claimed_by_agent_id).toBe("agent.ci");
  });

  it("reopens done CI tasks when the same check fails again", () => {
    const plan = buildCodexProjectCiTaskSyncPlan({
      settings: {
        ci_auto_task_enabled: true,
      },
      tasks: [
        {
          task_id: "ci-existing",
          title: "Fix CI failure",
          status: "done",
          tags: ["ci", "ci-key:github::build::lint::main"],
        },
      ],
      failures: [
        {
          provider: "github",
          pipeline: "build",
          job: "lint",
          branch: "main",
          status: "failed",
        },
      ],
      now_iso: "2026-03-11T05:02:00.000Z",
    });

    expect(plan.ci_metrics.reopened_count).toBe(1);
    expect(plan.task_upserts[0]?.action).toBe("reopen");
    expect(plan.task_upserts[0]?.task.task_id).toBe("ci-existing");
    expect(plan.dispatch_task_ids).toEqual(["ci-existing"]);

    const settingsAfter = buildProjectSettingsAfterCodexCiSync({
      settings: {
        ci_last_failed_job_count: 0,
      },
      failed_job_count: plan.ci_metrics.unique_failure_count,
      synced_at_utc: "2026-03-11T05:03:00.000Z",
    });

    expect(settingsAfter.ci_last_failed_job_count).toBe(1);
    expect(settingsAfter.ci_last_sync_at_utc).toBe("2026-03-11T05:03:00.000Z");
  });

  it("parses failed checks from multiple host collection keys", () => {
    const failures = parseCodexProjectCiFailures({
      checks: [
        {
          name: "unit",
          workflow: "build",
          state: "failed",
          branch: "feature/perf",
        },
        {
          name: "deploy",
          workflow: "release",
          state: "success",
          branch: "main",
        },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.job).toBe("unit");
    expect(failures[0]?.status).toBe("failed");
  });

  it("caps parsed failures from large host payloads", () => {
    const failures = parseCodexProjectCiFailures({
      runs: Array.from({ length: 400 }, (_unused, index) => ({
        provider: "github",
        workflow_name: "build",
        job_name: `job-${index + 1}`,
        conclusion: "failure",
        ref: "refs/heads/main",
      })),
    });

    expect(failures).toHaveLength(256);
    expect(failures[0]?.job).toBe("job-1");
    expect(failures[255]?.job).toBe("job-256");
  });
});
