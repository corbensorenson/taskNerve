import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadProjectCodexSettings, writeProjectCodexSettings } from "../src/io/projectCodexSettingsStore.js";
import { loadProjectRegistry, writeProjectRegistry } from "../src/io/projectRegistryStore.js";
import { timelineProjectCodexSettingsPath } from "../src/io/paths.js";

describe("native repo-local stores", () => {
  it("loads and persists project codex settings in .tasknerve", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-repo-"));
    const loaded = await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/example.git",
    });

    expect(loaded.git_origin_url).toBe("git@github.com:acme/example.git");
    expect(loaded.worker_single_message_mode).toBe(true);

    await writeProjectCodexSettings(repoRoot, {
      ...loaded,
      controller_default_model: "gpt-5-codex-controller",
    });

    const raw = await readFile(timelineProjectCodexSettingsPath(repoRoot), "utf8");
    expect(raw).toMatch(/gpt-5-codex-controller/);
  });

  it("loads and persists the global project registry", async () => {
    const taskNerveHome = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-home-"));
    const env = { ...process.env, TASKNERVE_HOME: taskNerveHome };
    const initial = await loadProjectRegistry(env);

    expect(initial.projects).toEqual([]);

    await writeProjectRegistry(
      {
        ...initial,
        projects: [
          {
            name: "zeta",
            repo_root: "/tmp/zeta",
            added_at_utc: "2026-03-10T00:00:00.000Z",
            updated_at_utc: "2026-03-10T00:00:00.000Z",
            last_activity_at_utc: null,
            last_opened_at_utc: null,
          },
          {
            name: "alpha",
            repo_root: "/tmp/alpha",
            added_at_utc: "2026-03-10T00:00:00.000Z",
            updated_at_utc: "2026-03-10T00:00:00.000Z",
            last_activity_at_utc: null,
            last_opened_at_utc: null,
          },
        ],
      },
      env,
    );

    const reloaded = await loadProjectRegistry(env);
    expect(reloaded.projects.map((project) => project.name)).toEqual(["alpha", "zeta"]);
  });
});
