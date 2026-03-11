import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

  it("does not rewrite project codex settings when nothing changed", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-repo-"));
    await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/example.git",
    });
    const filePath = timelineProjectCodexSettingsPath(repoRoot);
    const firstStat = await stat(filePath);

    await new Promise((resolve) => setTimeout(resolve, 25));

    await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/example.git",
    });
    const secondStat = await stat(filePath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("reloads project codex settings after external file mutation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-repo-"));
    await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/example.git",
    });
    const filePath = timelineProjectCodexSettingsPath(repoRoot);
    const current = JSON.parse(await readFile(filePath, "utf8"));
    current.controller_default_model = "gpt-5-codex-controller";

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

    const reloaded = await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/example.git",
    });
    expect(reloaded.controller_default_model).toBe("gpt-5-codex-controller");
  });

  it("upgrades persisted git origin when discovered after initial load", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-repo-"));
    const first = await loadProjectCodexSettings({
      repoRoot,
    });
    expect(first.git_origin_url).toBeNull();

    const filePath = timelineProjectCodexSettingsPath(repoRoot);
    const firstStat = await stat(filePath);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/discovered.git",
    });
    const secondStat = await stat(filePath);

    expect(second.git_origin_url).toBe("git@github.com:acme/discovered.git");
    expect(secondStat.mtimeMs).toBeGreaterThan(firstStat.mtimeMs);
  });

  it("keeps persisted git origin stable across subsequent loads with different origin hints", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-repo-"));
    const first = await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/primary.git",
    });
    expect(first.git_origin_url).toBe("git@github.com:acme/primary.git");

    const filePath = timelineProjectCodexSettingsPath(repoRoot);
    const firstStat = await stat(filePath);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await loadProjectCodexSettings({
      repoRoot,
      gitOriginUrl: "git@github.com:acme/secondary.git",
    });
    const secondStat = await stat(filePath);

    expect(second.git_origin_url).toBe("git@github.com:acme/primary.git");
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
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

  it("does not rewrite project registry when content is unchanged", async () => {
    const taskNerveHome = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-home-"));
    const env = { ...process.env, TASKNERVE_HOME: taskNerveHome };
    await loadProjectRegistry(env);
    const filePath = path.join(taskNerveHome, "projects.json");
    const firstStat = await stat(filePath);

    await new Promise((resolve) => setTimeout(resolve, 25));

    await loadProjectRegistry(env);
    const secondStat = await stat(filePath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("reloads project registry after external file mutation", async () => {
    const taskNerveHome = await mkdtemp(path.join(os.tmpdir(), "tasknerve-native-home-"));
    const env = { ...process.env, TASKNERVE_HOME: taskNerveHome };
    await loadProjectRegistry(env);
    const filePath = path.join(taskNerveHome, "projects.json");
    const current = JSON.parse(await readFile(filePath, "utf8"));
    current.projects = [
      {
        name: "beta",
        repo_root: "/tmp/beta",
        added_at_utc: "2026-03-10T00:00:00.000Z",
        updated_at_utc: "2026-03-10T00:00:00.000Z",
        last_activity_at_utc: null,
        last_opened_at_utc: null,
      },
    ];

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

    const reloaded = await loadProjectRegistry(env);
    expect(reloaded.projects.map((project) => project.name)).toEqual(["beta"]);
  });
});
