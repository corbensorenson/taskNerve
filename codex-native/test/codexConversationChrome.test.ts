import { describe, expect, it } from "vitest";

import { buildCodexConversationChromeSnapshot } from "../src/integration/codexConversationChrome.js";

describe("codex conversation chrome", () => {
  it("hides topbar commit/terminal controls and keeps terminal toggle in footer", () => {
    const snapshot = buildCodexConversationChromeSnapshot({
      taskCount: 12,
      taskDrawerOpen: false,
      terminalOpen: true,
      currentBranch: "tasknerve/main",
      branches: ["tasknerve/main", "feature/ab-test"],
      resourceStats: {
        cpuPercent: 38,
        gpuPercent: 12,
      },
    });

    expect(snapshot.integrationMode).toBe("codex-native-host");
    expect(snapshot.topbar.commitButton.visible).toBe(false);
    expect(snapshot.topbar.terminalToggle.visible).toBe(false);
    expect(snapshot.topbar.taskCountButton.opens).toBe("task-drawer");
    expect(snapshot.topbar.sidebarCollapsedProjectActions.visible).toBe(true);
    expect(snapshot.topbar.sidebarCollapsedProjectActions.showWhen).toBe("sidebar-collapsed");
    expect(snapshot.topbar.sidebarCollapsedProjectActions.placement).toBe("top-left");
    expect(snapshot.topbar.sidebarCollapsedProjectActions.importProjectButton.action).toBe(
      "topbar-import-project-click",
    );
    expect(snapshot.topbar.sidebarCollapsedProjectActions.newProjectButton.action).toBe(
      "topbar-new-project-click",
    );

    expect(snapshot.footer.terminalToggle.visible).toBe(true);
    expect(snapshot.footer.terminalToggle.location).toBe("footer");
    expect(snapshot.footer.terminalToggle.active).toBe(true);

    expect(snapshot.footer.branchSelector.visible).toBe(true);
    expect(snapshot.footer.branchSelector.currentBranch).toBe("tasknerve/main");
    expect(snapshot.footer.branchSelector.branches).toEqual([
      "tasknerve/main",
      "feature/ab-test",
    ]);

    expect(snapshot.footer.resourceStats.visible).toBe(true);
    expect(snapshot.footer.resourceStats.cpuPercent).toBe(38);
    expect(snapshot.footer.resourceStats.gpuPercent).toBe(12);
  });

  it("uses stable defaults when optional chrome data is missing", () => {
    const snapshot = buildCodexConversationChromeSnapshot();

    expect(snapshot.topbar.taskCountButton.label).toBe("0 tasks left");
    expect(snapshot.topbar.sidebarCollapsedProjectActions.importProjectButton.label).toBe(
      "Import existing project",
    );
    expect(snapshot.topbar.sidebarCollapsedProjectActions.newProjectButton.label).toBe(
      "Add new project",
    );
    expect(snapshot.footer.branchSelector.currentBranch).toBe("tasknerve/main");
    expect(snapshot.footer.resourceStats.cpuPercent).toBeNull();
    expect(snapshot.footer.resourceStats.gpuPercent).toBeNull();
  });

  it("reuses snapshot objects when normalized chrome inputs are unchanged", () => {
    const first = buildCodexConversationChromeSnapshot({
      taskCount: 8.2,
      taskDrawerOpen: false,
      terminalOpen: true,
      currentBranch: " tasknerve/main ",
      branches: ["tasknerve/main", "feature/ab-test", "feature/ab-test"],
      resourceStats: {
        cpuPercent: 42.8,
        gpuPercent: 11,
        memoryPercent: 57.4,
        thermalPressure: " nominal ",
      },
    });

    const second = buildCodexConversationChromeSnapshot({
      taskCount: 8,
      taskDrawerOpen: false,
      terminalOpen: true,
      currentBranch: "tasknerve/main",
      branches: ["tasknerve/main", "feature/ab-test"],
      resourceStats: {
        cpuPercent: 42.8,
        gpuPercent: 11,
        memoryPercent: 57.4,
        thermalPressure: "nominal",
      },
    });

    expect(second).toBe(first);
  });
});
