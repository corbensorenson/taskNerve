export interface CodexConversationChromeResourceStats {
  cpuPercent: number | null;
  gpuPercent: number | null;
  memoryPercent: number | null;
  thermalPressure: string | null;
  capturedAtUtc: string | null;
}

export interface CodexConversationChromeStateInput {
  taskCount?: number;
  taskDrawerOpen?: boolean;
  terminalOpen?: boolean;
  currentBranch?: string | null;
  branches?: string[];
  resourceStats?: Partial<CodexConversationChromeResourceStats> | null;
}

export interface CodexConversationChromeSnapshot {
  integrationMode: "codex-native-host";
  topbar: {
    commitButton: {
      visible: false;
    };
    terminalToggle: {
      visible: false;
      location: "topbar";
    };
    taskCountButton: {
      visible: true;
      taskCount: number;
      label: string;
      opens: "task-drawer";
      action: "topbar-task-count-click";
    };
  };
  footer: {
    terminalToggle: {
      visible: true;
      location: "footer";
      active: boolean;
      action: "footer-terminal-toggle-click";
    };
    branchSelector: {
      visible: true;
      currentBranch: string;
      branches: string[];
      action: "footer-branch-switch";
    };
    resourceStats: {
      visible: true;
      cpuPercent: number | null;
      gpuPercent: number | null;
      memoryPercent: number | null;
      thermalPressure: string | null;
      capturedAtUtc: string | null;
    };
  };
  taskDrawer: {
    open: boolean;
  };
}

const DEFAULT_BRANCH = "tasknerve/main";

interface ChromeSnapshotMemo {
  taskCount: number;
  taskDrawerOpen: boolean;
  terminalOpen: boolean;
  currentBranch: string;
  branches: string[];
  resourceStats: CodexConversationChromeResourceStats;
  snapshot: CodexConversationChromeSnapshot;
}

let lastChromeSnapshotMemo: ChromeSnapshotMemo | null = null;

function normalizeTaskCount(value: unknown): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(Number(value)));
}

function taskCountLabel(taskCount: number): string {
  if (taskCount === 1) {
    return "1 task left";
  }
  return `${taskCount} tasks left`;
}

function normalizeBranchList(currentBranch: string, branches: string[]): string[] {
  const normalized = [...new Set([currentBranch, ...branches].map((entry) => String(entry || "").trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [currentBranch];
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function sameResourceStats(
  left: CodexConversationChromeResourceStats,
  right: CodexConversationChromeResourceStats,
): boolean {
  return (
    left.cpuPercent === right.cpuPercent &&
    left.gpuPercent === right.gpuPercent &&
    left.memoryPercent === right.memoryPercent &&
    left.thermalPressure === right.thermalPressure &&
    left.capturedAtUtc === right.capturedAtUtc
  );
}

function normalizeResourceStats(
  stats: Partial<CodexConversationChromeResourceStats> | null | undefined,
): CodexConversationChromeResourceStats {
  return {
    cpuPercent: Number.isFinite(stats?.cpuPercent) ? Number(stats?.cpuPercent) : null,
    gpuPercent: Number.isFinite(stats?.gpuPercent) ? Number(stats?.gpuPercent) : null,
    memoryPercent: Number.isFinite(stats?.memoryPercent) ? Number(stats?.memoryPercent) : null,
    thermalPressure: typeof stats?.thermalPressure === "string" && stats.thermalPressure.trim()
      ? stats.thermalPressure.trim()
      : null,
    capturedAtUtc: typeof stats?.capturedAtUtc === "string" && stats.capturedAtUtc.trim()
      ? stats.capturedAtUtc.trim()
      : null,
  };
}

export function buildCodexConversationChromeSnapshot(
  input: CodexConversationChromeStateInput = {},
): CodexConversationChromeSnapshot {
  const taskCount = normalizeTaskCount(input.taskCount);
  const taskDrawerOpen = Boolean(input.taskDrawerOpen);
  const terminalOpen = Boolean(input.terminalOpen);
  const currentBranch =
    typeof input.currentBranch === "string" && input.currentBranch.trim()
      ? input.currentBranch.trim()
      : DEFAULT_BRANCH;
  const branches = normalizeBranchList(currentBranch, input.branches || []);
  const resourceStats = normalizeResourceStats(input.resourceStats);
  const previousMemo = lastChromeSnapshotMemo;

  if (
    previousMemo &&
    previousMemo.taskCount === taskCount &&
    previousMemo.taskDrawerOpen === taskDrawerOpen &&
    previousMemo.terminalOpen === terminalOpen &&
    previousMemo.currentBranch === currentBranch &&
    sameStringArray(previousMemo.branches, branches) &&
    sameResourceStats(previousMemo.resourceStats, resourceStats)
  ) {
    return previousMemo.snapshot;
  }

  const snapshot: CodexConversationChromeSnapshot = {
    integrationMode: "codex-native-host",
    topbar: {
      commitButton: {
        visible: false,
      },
      terminalToggle: {
        visible: false,
        location: "topbar",
      },
      taskCountButton: {
        visible: true,
        taskCount,
        label: taskCountLabel(taskCount),
        opens: "task-drawer",
        action: "topbar-task-count-click",
      },
    },
    footer: {
      terminalToggle: {
        visible: true,
        location: "footer",
        active: terminalOpen,
        action: "footer-terminal-toggle-click",
      },
      branchSelector: {
        visible: true,
        currentBranch,
        branches,
        action: "footer-branch-switch",
      },
      resourceStats: {
        visible: true,
        cpuPercent: resourceStats.cpuPercent,
        gpuPercent: resourceStats.gpuPercent,
        memoryPercent: resourceStats.memoryPercent,
        thermalPressure: resourceStats.thermalPressure,
        capturedAtUtc: resourceStats.capturedAtUtc,
      },
    },
    taskDrawer: {
      open: taskDrawerOpen,
    },
  };

  lastChromeSnapshotMemo = {
    taskCount,
    taskDrawerOpen,
    terminalOpen,
    currentBranch,
    branches,
    resourceStats,
    snapshot,
  };

  return snapshot;
}
