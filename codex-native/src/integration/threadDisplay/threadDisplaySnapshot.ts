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
const snapshotMemoByThread = new WeakMap<object, SnapshotMemo>();
const TURN_COLLECTION_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ["conversation", "turns"],
  ["thread", "turns"],
  ["turns"],
  ["messages"],
  ["conversation", "turn_mapping"],
  ["turn_mapping"],
];

function memoForThread(thread: unknown): SnapshotMemo | null {
  if (!thread || typeof thread !== "object") {
    return lastSnapshotMemo && lastSnapshotMemo.thread === thread ? lastSnapshotMemo : null;
  }
  return snapshotMemoByThread.get(thread) ?? null;
}

function rememberSnapshotMemo(memo: SnapshotMemo) {
  if (memo.thread && typeof memo.thread === "object") {
    snapshotMemoByThread.set(memo.thread, memo);
  }
  lastSnapshotMemo = memo;
}

function normalizeTurnKey(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeGeneratedAtUtc(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPath(root: unknown, path: ReadonlyArray<string>): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record || !(segment in record)) {
      return null;
    }
    current = record[segment];
  }
  return current;
}

function turnCollectionReference(thread: unknown): unknown {
  for (const path of TURN_COLLECTION_PATHS) {
    const value = readPath(thread, path);
    if (Array.isArray(value) || asRecord(value)) {
      return value;
    }
  }
  return Array.isArray(thread) ? thread : null;
}

function sameTurnCollectionReference(left: unknown, right: unknown): boolean {
  const leftReference = turnCollectionReference(left);
  return Boolean(leftReference) && leftReference === turnCollectionReference(right);
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

function likelyHistoryPrepended(
  previousEntries: ThreadDisplaySnapshot["entries"],
  nextEntries: ThreadDisplaySnapshot["entries"],
): boolean {
  if (previousEntries.length === 0 || nextEntries.length <= previousEntries.length) {
    return false;
  }

  const previousFirst = previousEntries[0]?.entry_id;
  if (!previousFirst) {
    return false;
  }
  if (nextEntries[0]?.entry_id === previousFirst) {
    return false;
  }

  // Fast path: prepended history usually shifts the old first entry by delta.
  const delta = nextEntries.length - previousEntries.length;
  if (delta > 0 && nextEntries[delta]?.entry_id === previousFirst) {
    return true;
  }

  // Guarded fallback search for reshuffled wrappers without scanning huge arrays.
  const maxProbe = Math.min(nextEntries.length - 1, 64);
  for (let index = 1; index <= maxProbe; index += 1) {
    if (nextEntries[index]?.entry_id === previousFirst) {
      return true;
    }
  }
  return false;
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
  const previousMemo = memoForThread(options.thread) ?? lastSnapshotMemo;
  const canReuseGeneratedAt =
    previousMemo &&
    (previousMemo.thread === options.thread ||
      sameTurnCollectionReference(previousMemo.thread, options.thread));
  const effectiveGeneratedAtUtc =
    generatedAtUtc ||
    (canReuseGeneratedAt ? previousMemo.generatedAtUtc : new Date().toISOString());
  const entries = extractThreadDisplayEntries(options.thread, effectiveGeneratedAtUtc);
  if (
    previousMemo &&
    previousMemo.generatedAtUtc === effectiveGeneratedAtUtc &&
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
  const historyPrependedLikely =
    previousMemo && previousMemo.entries !== entries
      ? likelyHistoryPrepended(previousMemo.entries, entries)
      : false;
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
          historyPrependedLikely,
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

  rememberSnapshotMemo({
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
  });

  return snapshot;
}
