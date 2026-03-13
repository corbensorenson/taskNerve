import type { CodexConversationDisplaySnapshot } from "./codexConversationDisplay.js";
import type { ThreadViewportState } from "./threadDisplay/index.js";

const MIN_SCROLL_COMMAND_INTERVAL_MS = 72;
const SCROLL_TOP_EPSILON_PX = 1;
const JUMP_SCROLL_SUPPRESSION_MS = 260;

export type CodexConversationInteractionEvent =
  | {
      type: "display-updated";
      viewport?: ThreadViewportState | null;
      userScrolling?: boolean;
      nowMs?: number;
    }
  | {
      type: "user-scroll-start";
      viewport?: ThreadViewportState | null;
      nowMs?: number;
    }
  | {
      type: "user-scroll-end";
      viewport?: ThreadViewportState | null;
      nowMs?: number;
    }
  | {
      type: "jump-prev-user-message";
      nowMs?: number;
    }
  | {
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
  suppressAutoScrollUntilMs: number | null;
}

export type CodexConversationInteractionCommand =
  | {
      type: "set-current-turn-key";
      turnKey: string;
      reason: "jump-button" | "scroll-decision";
    }
  | {
      type: "scroll-to-turn";
      turnKey: string;
      behavior: "auto" | "smooth";
      align: "start" | "center";
      reason: "jump-button" | "scroll-decision";
    }
  | {
      type: "scroll-to-top";
      scrollTopPx: number;
      behavior: "auto" | "smooth";
      reason: "stick-to-bottom" | "preserve-offset" | "jump-button";
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

function normalizeTurnKey(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeViewport(value: ThreadViewportState | null | undefined): ThreadViewportState | null {
  if (!value) {
    return null;
  }
  const scrollTopPx = Number.isFinite(value.scroll_top_px) ? Number(value.scroll_top_px) : 0;
  const scrollHeightPx = Number.isFinite(value.scroll_height_px) ? Number(value.scroll_height_px) : 0;
  const viewportHeightPx = Number.isFinite(value.viewport_height_px) ? Number(value.viewport_height_px) : 0;
  return {
    scroll_top_px: Math.max(0, Math.round(scrollTopPx)),
    scroll_height_px: Math.max(0, Math.round(scrollHeightPx)),
    viewport_height_px: Math.max(0, Math.round(viewportHeightPx)),
  };
}

function normalizeState(
  state: CodexConversationInteractionState | null | undefined,
): CodexConversationInteractionState {
  return {
    integrationMode: "codex-native-host",
    currentTurnKey: normalizeTurnKey(state?.currentTurnKey),
    userScrolling: Boolean(state?.userScrolling),
    viewport: normalizeViewport(state?.viewport),
    lastScrollCommandAtMs: Number.isFinite(state?.lastScrollCommandAtMs)
      ? Number(state?.lastScrollCommandAtMs)
      : null,
    lastScrollTopPx: Number.isFinite(state?.lastScrollTopPx) ? Number(state?.lastScrollTopPx) : null,
    lastScrollTurnKey: normalizeTurnKey(state?.lastScrollTurnKey),
    suppressAutoScrollUntilMs: Number.isFinite(state?.suppressAutoScrollUntilMs)
      ? Number(state?.suppressAutoScrollUntilMs)
      : null,
  };
}

function maxScrollTop(viewport: ThreadViewportState | null): number | null {
  if (!viewport) {
    return null;
  }
  return Math.max(0, viewport.scroll_height_px - viewport.viewport_height_px);
}

function clampScrollTop(value: number, viewport: ThreadViewportState | null): number {
  const normalized = Math.max(0, Math.round(value));
  const max = maxScrollTop(viewport);
  if (!Number.isFinite(max)) {
    return normalized;
  }
  return Math.max(0, Math.min(normalized, Number(max)));
}

function shouldThrottleScroll(state: CodexConversationInteractionState, nowMs: number): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(state.lastScrollCommandAtMs)) {
    return false;
  }
  return nowMs - Number(state.lastScrollCommandAtMs) < MIN_SCROLL_COMMAND_INTERVAL_MS;
}

function resolveJumpTarget(
  snapshot: CodexConversationDisplaySnapshot,
  eventType: CodexConversationInteractionEvent["type"],
): string | null {
  if (eventType === snapshot.jumpControls.upAction) {
    return normalizeTurnKey(snapshot.jumpControls.upTurnKey);
  }
  if (eventType === snapshot.jumpControls.downAction) {
    return normalizeTurnKey(snapshot.jumpControls.downTurnKey);
  }
  return null;
}

function resolveJumpScrollTopPx(
  snapshot: CodexConversationDisplaySnapshot,
  eventType: CodexConversationInteractionEvent["type"],
): number | null {
  if (eventType === snapshot.jumpControls.upAction) {
    return Number.isFinite(snapshot.jumpControls.upScrollTopPx)
      ? Number(snapshot.jumpControls.upScrollTopPx)
      : null;
  }
  if (eventType === snapshot.jumpControls.downAction) {
    return Number.isFinite(snapshot.jumpControls.downScrollTopPx)
      ? Number(snapshot.jumpControls.downScrollTopPx)
      : null;
  }
  return null;
}

function setScrollApplied(
  state: CodexConversationInteractionState,
  nowMs: number,
  scrollTopPx: number | null,
  scrollTurnKey: string | null,
) {
  state.lastScrollCommandAtMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  state.lastScrollTopPx = Number.isFinite(scrollTopPx) ? Number(scrollTopPx) : null;
  state.lastScrollTurnKey = normalizeTurnKey(scrollTurnKey);
}

function applyJumpCommand(options: {
  snapshot: CodexConversationDisplaySnapshot;
  state: CodexConversationInteractionState;
  eventType: CodexConversationInteractionEvent["type"];
  nowMs: number;
}): CodexConversationInteractionCommand[] {
  const turnKey = resolveJumpTarget(options.snapshot, options.eventType);
  if (!turnKey) {
    return [];
  }
  const jumpScrollTopPx = resolveJumpScrollTopPx(options.snapshot, options.eventType);
  options.state.currentTurnKey = turnKey;
  options.state.suppressAutoScrollUntilMs = options.nowMs + JUMP_SCROLL_SUPPRESSION_MS;
  setScrollApplied(options.state, options.nowMs, jumpScrollTopPx, turnKey);
  return [
    {
      type: "set-current-turn-key",
      turnKey,
      reason: "jump-button",
    },
    Number.isFinite(jumpScrollTopPx)
      ? {
          type: "scroll-to-top",
          scrollTopPx: Number(jumpScrollTopPx),
          behavior: "smooth",
          reason: "jump-button",
        }
      : {
          type: "scroll-to-turn",
          turnKey,
          behavior: "smooth",
          align: "start",
          reason: "jump-button",
        },
  ];
}

function applyDecisionCommand(options: {
  snapshot: CodexConversationDisplaySnapshot;
  state: CodexConversationInteractionState;
  nowMs: number;
}): CodexConversationInteractionCommand[] {
  const decision = options.snapshot.scrollDecision;
  if (options.state.userScrolling || decision.mode === "no-op") {
    return [];
  }
  if (
    Number.isFinite(options.state.suppressAutoScrollUntilMs) &&
    options.nowMs < Number(options.state.suppressAutoScrollUntilMs)
  ) {
    return [];
  }

  if (decision.mode === "jump-to-turn") {
    const turnKey = normalizeTurnKey(decision.turn_key);
    if (!turnKey) {
      return [];
    }
    if (
      options.state.lastScrollTurnKey === turnKey &&
      shouldThrottleScroll(options.state, options.nowMs)
    ) {
      return [];
    }
    options.state.currentTurnKey = turnKey;
    setScrollApplied(options.state, options.nowMs, null, turnKey);
    return [
      {
        type: "set-current-turn-key",
        turnKey,
        reason: "scroll-decision",
      },
      {
        type: "scroll-to-turn",
        turnKey,
        behavior: decision.behavior ?? "smooth",
        align: "start",
        reason: "scroll-decision",
      },
    ];
  }

  const targetScrollTop = Number.isFinite(decision.scroll_top_px)
    ? clampScrollTop(Number(decision.scroll_top_px), options.state.viewport)
    : null;
  if (!Number.isFinite(targetScrollTop)) {
    return [];
  }
  if (
    Number.isFinite(options.state.lastScrollTopPx) &&
    Math.abs(Number(options.state.lastScrollTopPx) - Number(targetScrollTop)) <= SCROLL_TOP_EPSILON_PX &&
    shouldThrottleScroll(options.state, options.nowMs)
  ) {
    return [];
  }
  if (
    options.state.viewport &&
    Math.abs(options.state.viewport.scroll_top_px - Number(targetScrollTop)) <= SCROLL_TOP_EPSILON_PX
  ) {
    return [];
  }
  if (shouldThrottleScroll(options.state, options.nowMs)) {
    return [];
  }

  setScrollApplied(options.state, options.nowMs, Number(targetScrollTop), null);
  return [
    {
      type: "scroll-to-top",
      scrollTopPx: Number(targetScrollTop),
      behavior: decision.behavior ?? "auto",
      reason: decision.mode === "stick-to-bottom" ? "stick-to-bottom" : "preserve-offset",
    },
  ];
}

export function conversationInteractionStep(
  input: CodexConversationInteractionInput,
): CodexConversationInteractionResult {
  const nowMs = Number.isFinite(input.event.nowMs) ? Number(input.event.nowMs) : Date.now();
  const state = normalizeState(input.state);

  if ("viewport" in input.event) {
    const viewport = normalizeViewport(input.event.viewport);
    if (viewport) {
      state.viewport = viewport;
    }
  }

  if (input.event.type === "user-scroll-start") {
    state.userScrolling = true;
    state.suppressAutoScrollUntilMs = null;
    return {
      integrationMode: "codex-native-host",
      state,
      commands: [],
    };
  }

  if (input.event.type === "user-scroll-end") {
    state.userScrolling = false;
    state.suppressAutoScrollUntilMs = null;
    return {
      integrationMode: "codex-native-host",
      state,
      commands: applyDecisionCommand({
        snapshot: input.snapshot,
        state,
        nowMs,
      }),
    };
  }

  if (input.event.type === "display-updated") {
    if (typeof input.event.userScrolling === "boolean") {
      state.userScrolling = input.event.userScrolling;
    }
    return {
      integrationMode: "codex-native-host",
      state,
      commands: applyDecisionCommand({
        snapshot: input.snapshot,
        state,
        nowMs,
      }),
    };
  }

  return {
    integrationMode: "codex-native-host",
    state,
    commands: applyJumpCommand({
      snapshot: input.snapshot,
      state,
      eventType: input.event.type,
      nowMs,
    }),
  };
}
