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
export declare function buildCodexConversationChromeSnapshot(input?: CodexConversationChromeStateInput): CodexConversationChromeSnapshot;
//# sourceMappingURL=codexConversationChrome.d.ts.map