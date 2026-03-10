import { describe, expect, it } from "vitest";

import { buildControllerBootstrapPrompt } from "../src/domain/controllerBootstrap.js";

describe("controller bootstrap prompt", () => {
  it("includes project contracts and worker orchestration", () => {
    const prompt = buildControllerBootstrapPrompt({
      projectName: "moecot-manifest",
      repoRoot: "/Users/adimus/Documents/moecot-manifest",
      currentStateSignals: ["Rust backend still present", "Codex-native panel is active"],
      timelineSignals: ["Latest checkpoint mentions backlog cleanup"],
      queueSummary: "12 open tasks, 3 claimed tasks",
    });

    expect(prompt).toMatch(/project_goals\.md/);
    expect(prompt).toMatch(/project_manifest\.md/);
    expect(prompt).toMatch(/Ask the user how many worker threads should be spawned/);
    expect(prompt).toMatch(/built-in TaskNerve skill/);
  });
});
