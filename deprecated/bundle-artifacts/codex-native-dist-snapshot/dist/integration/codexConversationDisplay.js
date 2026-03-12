import { buildThreadDisplaySnapshot, } from "./threadDisplay/index.js";
const snapshotConversionCache = new WeakMap();
function toThreadDisplayOptions(options) {
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
function toCodexSnapshot(snapshot) {
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
export function buildCodexConversationDisplaySnapshot(options) {
    return toCodexSnapshot(buildThreadDisplaySnapshot(toThreadDisplayOptions(options)));
}
//# sourceMappingURL=codexConversationDisplay.js.map