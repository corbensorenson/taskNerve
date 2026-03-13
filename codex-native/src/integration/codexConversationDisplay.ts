import {
  buildThreadDisplaySnapshot,
  type BuildThreadDisplayOptions,
  type ThreadDisplayEntry,
  type ThreadDisplaySnapshot,
  type ThreadScrollDecision,
  type ThreadVirtualWindow,
} from "./threadDisplay/index.js";

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
  upScrollTopPx: number | null;
  downScrollTopPx: number | null;
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

const snapshotConversionCache = new WeakMap<
  ThreadDisplaySnapshot,
  CodexConversationDisplaySnapshot
>();

function toThreadDisplayOptions(
  options: CodexConversationDisplayOptions,
): BuildThreadDisplayOptions {
  return {
    thread: options.thread,
    current_turn_key: options.currentTurnKey,
    focus_turn_key: options.focusTurnKey,
    generated_at_utc: options.generatedAtUtc,
    viewport: options.viewport,
    previous_viewport: options.previousViewport,
    previous_entry_count: options.previousEntryCount,
    measured_heights_px: options.measuredHeightsPx,
    default_row_height_px: options.defaultRowHeightPx,
  };
}

function toCodexSnapshot(snapshot: ThreadDisplaySnapshot): CodexConversationDisplaySnapshot {
  const cached = snapshotConversionCache.get(snapshot);
  if (cached) {
    return cached;
  }

  const converted = {
    integrationMode: snapshot.integration_mode,
    generatedAtUtc: snapshot.generated_at_utc,
    entries: snapshot.entries,
    promptNavigation: {
      previousTurnKey: snapshot.prompt_navigation.previous_turn_key,
      nextTurnKey: snapshot.prompt_navigation.next_turn_key,
      userTurnKeys: snapshot.prompt_navigation.user_turn_keys,
    },
    jumpControls: {
      placement: snapshot.jump_controls.placement,
      upTurnKey: snapshot.jump_controls.up_turn_key,
      downTurnKey: snapshot.jump_controls.down_turn_key,
      upScrollTopPx: snapshot.jump_controls.up_scroll_top_px,
      downScrollTopPx: snapshot.jump_controls.down_scroll_top_px,
      canJumpUp: snapshot.jump_controls.can_jump_up,
      canJumpDown: snapshot.jump_controls.can_jump_down,
      upAction: snapshot.jump_controls.up_action,
      downAction: snapshot.jump_controls.down_action,
    },
    virtualWindow: snapshot.virtual_window,
    scrollDecision: snapshot.scroll_decision,
  };

  snapshotConversionCache.set(snapshot, converted);

  return converted;
}

export function buildCodexConversationDisplaySnapshot(
  options: CodexConversationDisplayOptions,
): CodexConversationDisplaySnapshot {
  return toCodexSnapshot(buildThreadDisplaySnapshot(toThreadDisplayOptions(options)));
}
