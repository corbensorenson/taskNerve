export function baseTurnKey(value) {
    return value.replace(/^(user|assistant):/i, "").trim();
}
function userTurnKeys(entries) {
    const seen = new Set();
    const keys = [];
    for (const entry of entries) {
        if (entry.role !== "user") {
            continue;
        }
        const turnKey = entry.turn_key.startsWith("user:")
            ? entry.turn_key
            : `user:${baseTurnKey(entry.turn_key)}`;
        if (!turnKey || seen.has(turnKey)) {
            continue;
        }
        seen.add(turnKey);
        keys.push(turnKey);
    }
    return keys;
}
function anchorIndex(keys, currentTurnKey) {
    if (keys.length === 0) {
        return -1;
    }
    if (!currentTurnKey || !currentTurnKey.trim()) {
        return keys.length - 1;
    }
    const normalizedCurrent = currentTurnKey.trim();
    const directIndex = keys.indexOf(normalizedCurrent);
    if (directIndex >= 0) {
        return directIndex;
    }
    const base = baseTurnKey(normalizedCurrent);
    const sameTurnIndex = keys.findIndex((key) => baseTurnKey(key) === base);
    return sameTurnIndex >= 0 ? sameTurnIndex : keys.length - 1;
}
export function buildPromptJumpControls(navigation) {
    return {
        placement: "left-of-send-voice",
        up_turn_key: navigation.previous_turn_key,
        down_turn_key: navigation.next_turn_key,
        can_jump_up: Boolean(navigation.previous_turn_key),
        can_jump_down: Boolean(navigation.next_turn_key),
        up_action: "jump-prev-user-message",
        down_action: "jump-next-user-message",
    };
}
export function buildPromptNavigationTarget(entries, currentTurnKey) {
    const keys = userTurnKeys(entries);
    if (keys.length === 0) {
        return {
            previous_turn_key: null,
            next_turn_key: null,
            user_turn_keys: [],
        };
    }
    const index = anchorIndex(keys, currentTurnKey);
    if (index < 0) {
        return {
            previous_turn_key: null,
            next_turn_key: null,
            user_turn_keys: keys,
        };
    }
    return {
        previous_turn_key: index > 0 ? keys[index - 1] : null,
        next_turn_key: index < keys.length - 1 ? keys[index + 1] : null,
        user_turn_keys: keys,
    };
}
//# sourceMappingURL=navigation.js.map