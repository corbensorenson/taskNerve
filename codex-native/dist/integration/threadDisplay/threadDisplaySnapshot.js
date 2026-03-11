import { buildPromptJumpControls, buildPromptNavigationTarget } from "./navigation.js";
import { extractThreadDisplayEntries } from "./extract.js";
import { decideThreadScrollBehavior } from "./scrollPolicy.js";
import { buildThreadVirtualWindow } from "./virtualization.js";
let lastSnapshotMemo = null;
const snapshotMemoByThread = new WeakMap();
function memoForThread(thread) {
    if (!thread || typeof thread !== "object") {
        return lastSnapshotMemo && lastSnapshotMemo.thread === thread ? lastSnapshotMemo : null;
    }
    return snapshotMemoByThread.get(thread) ?? null;
}
function rememberSnapshotMemo(memo) {
    if (memo.thread && typeof memo.thread === "object") {
        snapshotMemoByThread.set(memo.thread, memo);
    }
    lastSnapshotMemo = memo;
}
function normalizeTurnKey(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || null;
}
function normalizeGeneratedAtUtc(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || null;
}
function sameViewport(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return !left && !right;
    }
    return (left.scroll_top_px === right.scroll_top_px &&
        left.scroll_height_px === right.scroll_height_px &&
        left.viewport_height_px === right.viewport_height_px);
}
export function buildThreadDisplaySnapshot(options) {
    const generatedAtUtc = normalizeGeneratedAtUtc(options.generated_at_utc);
    const currentTurnKey = normalizeTurnKey(options.current_turn_key);
    const focusTurnKey = normalizeTurnKey(options.focus_turn_key);
    const previousEntryCount = Number.isFinite(options.previous_entry_count)
        ? Number(options.previous_entry_count)
        : 0;
    const previousMemo = memoForThread(options.thread) ?? lastSnapshotMemo;
    const effectiveGeneratedAtUtc = generatedAtUtc ||
        (previousMemo && previousMemo.thread === options.thread
            ? previousMemo.generatedAtUtc
            : new Date().toISOString());
    const entries = extractThreadDisplayEntries(options.thread, effectiveGeneratedAtUtc);
    if (previousMemo &&
        previousMemo.generatedAtUtc === effectiveGeneratedAtUtc &&
        previousMemo.thread === options.thread &&
        previousMemo.entries === entries &&
        previousMemo.currentTurnKey === currentTurnKey &&
        previousMemo.focusTurnKey === focusTurnKey &&
        sameViewport(previousMemo.viewport, options.viewport) &&
        sameViewport(previousMemo.previousViewport, options.previous_viewport) &&
        previousMemo.previousEntryCount === previousEntryCount &&
        previousMemo.measuredHeightsPx === options.measured_heights_px &&
        previousMemo.defaultRowHeightPx === options.default_row_height_px) {
        return previousMemo.snapshot;
    }
    const promptNavigation = previousMemo &&
        previousMemo.entries === entries &&
        previousMemo.currentTurnKey === currentTurnKey
        ? previousMemo.promptNavigation
        : buildPromptNavigationTarget(entries, currentTurnKey);
    const jumpControls = previousMemo && previousMemo.promptNavigation === promptNavigation
        ? previousMemo.jumpControls
        : buildPromptJumpControls(promptNavigation);
    const virtualWindow = previousMemo &&
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
    const scrollDecision = previousMemo &&
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
    const snapshot = {
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
//# sourceMappingURL=threadDisplaySnapshot.js.map