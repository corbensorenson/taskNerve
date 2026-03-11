import { buildPromptJumpControls, buildPromptNavigationTarget } from "./navigation.js";
import { extractThreadDisplayEntries } from "./extract.js";
import { decideThreadScrollBehavior } from "./scrollPolicy.js";
import type { BuildThreadDisplayOptions, ThreadDisplaySnapshot } from "./types.js";
import { buildThreadVirtualWindow } from "./virtualization.js";

interface SnapshotMemo {
  generatedAtUtc: string;
  thread: unknown;
  currentTurnKey: string | null;
  focusTurnKey: string | null;
  viewport: BuildThreadDisplayOptions["viewport"];
  previousViewport: BuildThreadDisplayOptions["previous_viewport"];
  previousEntryCount: number;
  measuredHeightsPx: BuildThreadDisplayOptions["measured_heights_px"];
  defaultRowHeightPx: number | undefined;
  entries: ThreadDisplaySnapshot["entries"];
  promptNavigation: ThreadDisplaySnapshot["prompt_navigation"];
  jumpControls: ThreadDisplaySnapshot["jump_controls"];
  virtualWindow: ThreadDisplaySnapshot["virtual_window"];
  scrollDecision: ThreadDisplaySnapshot["scroll_decision"];
  snapshot: ThreadDisplaySnapshot;
}

let lastSnapshotMemo: SnapshotMemo | null = null;

function normalizeTurnKey(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeGeneratedAtUtc(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function sameViewport(
  left: BuildThreadDisplayOptions["viewport"] | BuildThreadDisplayOptions["previous_viewport"],
  right: BuildThreadDisplayOptions["viewport"] | BuildThreadDisplayOptions["previous_viewport"],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return !left && !right;
  }
  return (
    left.scroll_top_px === right.scroll_top_px &&
    left.scroll_height_px === right.scroll_height_px &&
    left.viewport_height_px === right.viewport_height_px
  );
}

export function buildThreadDisplaySnapshot(
  options: BuildThreadDisplayOptions,
): ThreadDisplaySnapshot {
  const generatedAtUtc = normalizeGeneratedAtUtc(options.generated_at_utc);
  const currentTurnKey = normalizeTurnKey(options.current_turn_key);
  const focusTurnKey = normalizeTurnKey(options.focus_turn_key);
  const previousEntryCount = Number.isFinite(options.previous_entry_count)
    ? Number(options.previous_entry_count)
    : 0;
  const previousMemo = lastSnapshotMemo;
  const effectiveGeneratedAtUtc =
    generatedAtUtc ||
    (previousMemo && previousMemo.thread === options.thread
      ? previousMemo.generatedAtUtc
      : new Date().toISOString());
  const entries = extractThreadDisplayEntries(options.thread, effectiveGeneratedAtUtc);
  if (
    previousMemo &&
    previousMemo.generatedAtUtc === effectiveGeneratedAtUtc &&
    previousMemo.thread === options.thread &&
    previousMemo.entries === entries &&
    previousMemo.currentTurnKey === currentTurnKey &&
    previousMemo.focusTurnKey === focusTurnKey &&
    sameViewport(previousMemo.viewport, options.viewport) &&
    sameViewport(previousMemo.previousViewport, options.previous_viewport) &&
    previousMemo.previousEntryCount === previousEntryCount &&
    previousMemo.measuredHeightsPx === options.measured_heights_px &&
    previousMemo.defaultRowHeightPx === options.default_row_height_px
  ) {
    return previousMemo.snapshot;
  }

  const promptNavigation =
    previousMemo &&
    previousMemo.entries === entries &&
    previousMemo.currentTurnKey === currentTurnKey
      ? previousMemo.promptNavigation
      : buildPromptNavigationTarget(entries, currentTurnKey);
  const jumpControls =
    previousMemo && previousMemo.promptNavigation === promptNavigation
      ? previousMemo.jumpControls
      : buildPromptJumpControls(promptNavigation);
  const virtualWindow =
    previousMemo &&
    previousMemo.entries === entries &&
    sameViewport(previousMemo.viewport, options.viewport) &&
    previousMemo.measuredHeightsPx === options.measured_heights_px &&
    previousMemo.defaultRowHeightPx === options.default_row_height_px
      ? previousMemo.virtualWindow
      : buildThreadVirtualWindow({
          entries,
          viewport: options.viewport,
          measuredHeightsPx: options.measured_heights_px,
          defaultRowHeightPx: options.default_row_height_px,
        });
  const scrollDecision =
    previousMemo &&
    previousMemo.entries === entries &&
    previousMemo.focusTurnKey === focusTurnKey &&
    sameViewport(previousMemo.previousViewport, options.previous_viewport) &&
    sameViewport(previousMemo.viewport, options.viewport) &&
    previousMemo.previousEntryCount === previousEntryCount
      ? previousMemo.scrollDecision
      : decideThreadScrollBehavior({
          previousViewport: options.previous_viewport,
          nextViewport: options.viewport,
          previousEntryCount,
          nextEntryCount: entries.length,
          focusTurnKey,
        });

  const snapshot: ThreadDisplaySnapshot = {
    integration_mode: "codex-native-host",
    generated_at_utc: effectiveGeneratedAtUtc,
    entries,
    prompt_navigation: promptNavigation,
    jump_controls: jumpControls,
    virtual_window: virtualWindow,
    scroll_decision: scrollDecision,
  };

  lastSnapshotMemo = {
    generatedAtUtc: effectiveGeneratedAtUtc,
    thread: options.thread,
    currentTurnKey,
    focusTurnKey,
    viewport: options.viewport,
    previousViewport: options.previous_viewport,
    previousEntryCount,
    measuredHeightsPx: options.measured_heights_px,
    defaultRowHeightPx: options.default_row_height_px,
    entries,
    promptNavigation,
    jumpControls,
    virtualWindow,
    scrollDecision,
    snapshot,
  };

  return snapshot;
}
