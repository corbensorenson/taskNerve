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
    expect(prompt).toMatch(/taskNerve\/creating_project_skill\.md/);
    expect(prompt).toMatch(/taskNerve\/using_project_skill\.md/);
    expect(prompt).toMatch(/Ask the user how many worker threads should be spawned/);
    expect(prompt).toMatch(/built-in TaskNerve skill/);
    expect(prompt).toMatch(/Agents should never run git directly/);
    expect(prompt).toMatch(/TaskNerve-managed subsystem/);
    expect(prompt).toMatch(/Break tasks down small by default/);
    expect(prompt).toMatch(/Task authoring standard/);
    expect(prompt).toMatch(/acceptance_criteria/);
    expect(prompt).toMatch(/verification_steps/);
  });
});
