import { type BuildThreadDisplayOptions, type ThreadDisplayEntry, type ThreadScrollDecision, type ThreadVirtualWindow } from "./threadDisplay/index.js";
export interface CodexConversationDisplayOptions {
    thread: unknown;
    currentTurnKey?: string | null;
    focusTurnKey?: string | null;
    generatedAtUtc?: string | null;
    viewport?: BuildThreadDisplayOptions["viewport"];
    previousViewport?: BuildThreadDisplayOptions["previous_viewport"];
    previousEntryCount?: number;
    measuredHeightsPx?: Readonly<Record<string, number>>;
    defaultRowHeightPx?: number;
}
export interface CodexConversationDisplayNavigation {
    previousTurnKey: string | null;
    nextTurnKey: string | null;
    userTurnKeys: string[];
}
export interface CodexConversationDisplayJumpControls {
    placement: "left-of-send-voice";
    upTurnKey: string | null;
    downTurnKey: string | null;
    canJumpUp: boolean;
    canJumpDown: boolean;
    upAction: "jump-prev-user-message";
    downAction: "jump-next-user-message";
}
export interface CodexConversationDisplaySnapshot {
    integrationMode: "codex-native-host";
    generatedAtUtc: string;
    entries: ThreadDisplayEntry[];
    promptNavigation: CodexConversationDisplayNavigation;
    jumpControls: CodexConversationDisplayJumpControls;
    virtualWindow: ThreadVirtualWindow;
    scrollDecision: ThreadScrollDecision;
}
export declare function buildCodexConversationDisplaySnapshot(options: CodexConversationDisplayOptions): CodexConversationDisplaySnapshot;
//# sourceMappingURL=codexConversationDisplay.d.ts.map