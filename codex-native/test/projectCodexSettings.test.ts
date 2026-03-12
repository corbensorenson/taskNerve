import { describe, expect, it } from "vitest";

import {
  defaultProjectCodexSettings,
  normalizeProjectCodexSettings,
  resolveControllerModel,
  resolveWorkerModelForTask,
} from "../src/domain/projectCodexSettings.js";

describe("project codex settings", () => {
  it("defaults to single-message worker mode", () => {
    const settings = defaultProjectCodexSettings({
      nowIso: "2026-03-10T12:00:00.000Z",
      gitOriginUrl: "git@github.com:acme/example.git",
    });

    expect(settings.worker_single_message_mode).toBe(true);
    expect(settings.worker_model_routing_enabled).toBe(true);
    expect(settings.worker_route_wait_for_match).toBe(true);
    expect(settings.worker_route_allow_retarget).toBe(true);
    expect(settings.worker_route_prefer_spawn).toBe(true);
    expect(settings.worker_route_match_effort).toBe(true);
    expect(settings.task_quality_gate_enabled).toBe(true);
    expect(settings.task_quality_gate_min_score).toBe(80);
    expect(settings.task_quality_gate_include_ci).toBe(false);
    expect(settings.git_origin_url).toBe("git@github.com:acme/example.git");
    expect(settings.git_auto_sync_enabled).toBe(true);
    expect(settings.git_tasks_per_push_target).toBe(4);
    expect(settings.git_auto_sync_allowed_branches).toEqual([]);
    expect(settings.ci_auto_task_enabled).toBe(true);
    expect(settings.ci_failure_task_priority).toBe(9);
    expect(settings.trace_collection_enabled).toBe(true);
    expect(settings.trace_capture_controller).toBe(true);
    expect(settings.trace_capture_agents).toBe(true);
    expect(settings.trace_include_message_content).toBe(true);
    expect(settings.trace_max_content_chars).toBe(16000);
    expect(settings.self_improvement_enabled).toBe(true);
    expect(settings.self_improvement_auto_dispatch_enabled).toBe(true);
    expect(settings.self_improvement_max_tasks_per_run).toBe(2);
    expect(settings.self_improvement_open_task_limit).toBe(6);
    expect(settings.self_improvement_dispatch_cooldown_minutes).toBe(45);
    expect(settings.self_improvement_last_dispatch_at_utc).toBeNull();
    expect(settings.issues_sync_enabled).toBe(true);
    expect(settings.issues_auto_task_enabled).toBe(false);
    expect(settings.issues_filter_enabled).toBe(true);
    expect(settings.issues_filter_min_trust_score).toBe(65);
  });

  it("routes worker models by explicit override and intelligence level", () => {
    const settings = normalizeProjectCodexSettings({
      worker_model_routing_enabled: true,
      worker_default_model: "gpt-5-codex-medium",
      high_intelligence_model: "gpt-5-codex-high",
      max_intelligence_model: "gpt-5-codex-max",
    });

    expect(
      resolveWorkerModelForTask(settings, {
        suggested_model: "gpt-5-codex-custom",
        suggested_intelligence: "high",
      }),
    ).toBe("gpt-5-codex-custom");
    expect(resolveWorkerModelForTask(settings, { suggested_intelligence: "high" })).toBe(
      "gpt-5-codex-high",
    );
    expect(resolveWorkerModelForTask(settings, { suggested_intelligence: "max" })).toBe(
      "gpt-5-codex-max",
    );
    expect(resolveWorkerModelForTask(settings, { suggested_intelligence: "low" })).toBe(
      "gpt-5-codex-medium",
    );
  });

  it("resolves controller model independently", () => {
    const settings = normalizeProjectCodexSettings({
      controller_default_model: "gpt-5-codex-controller",
    });

    expect(resolveControllerModel(settings)).toBe("gpt-5-codex-controller");
  });
});
