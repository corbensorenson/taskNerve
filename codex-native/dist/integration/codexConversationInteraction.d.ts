import type { CodexConversationDisplaySnapshot } from "./codexConversationDisplay.js";
import type { ThreadViewportState } from "./threadDisplay/index.js";
export type CodexConversationInteractionEvent = {
    type: "display-updated";
    viewport?: ThreadViewportState | null;
    userScrolling?: boolean;
    nowMs?: number;
} | {
    type: "user-scroll-start";
    viewport?: ThreadViewportState | null;
    nowMs?: number;
} | {
    type: "user-scroll-end";
    viewport?: ThreadViewportState | null;
    nowMs?: number;
} | {
    type: "jump-prev-user-message";
    nowMs?: number;
} | {
    type: "jump-next-user-message";
    nowMs?: number;
};
export interface CodexConversationInteractionState {
    integrationMode: "codex-native-host";
    currentTurnKey: string | null;
    userScrolling: boolean;
    viewport: ThreadViewportState | null;
    lastScrollCommandAtMs: number | null;
    lastScrollTopPx: number | null;
    lastScrollTurnKey: string | null;
}
export type CodexConversationInteractionCommand = {
    type: "set-current-turn-key";
    turnKey: string;
    reason: "jump-button" | "scroll-decision";
} | {
    type: "scroll-to-turn";
    turnKey: string;
    behavior: "auto" | "smooth";
    align: "start" | "center";
    reason: "jump-button" | "scroll-decision";
} | {
    type: "scroll-to-top";
    scrollTopPx: number;
    behavior: "auto" | "smooth";
    reason: "stick-to-bottom" | "preserve-offset";
};
export interface CodexConversationInteractionInput {
    snapshot: CodexConversationDisplaySnapshot;
    event: CodexConversationInteractionEvent;
    state?: CodexConversationInteractionState | null;
}
export interface CodexConversationInteractionResult {
    integrationMode: "codex-native-host";
    state: CodexConversationInteractionState;
    commands: CodexConversationInteractionCommand[];
}
export declare function conversationInteractionStep(input: CodexConversationInteractionInput): CodexConversationInteractionResult;
//# sourceMappingURL=codexConversationInteraction.d.ts.map