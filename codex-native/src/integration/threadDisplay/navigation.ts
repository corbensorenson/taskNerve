import type {
  PromptJumpControls,
  PromptNavigationTarget,
  ThreadDisplayEntry,
} from "./types.js";

export function baseTurnKey(value: string): string {
  return value.replace(/^(user|assistant):/i, "").trim();
}

interface UserTurnKeyIndex {
  keys: string[];
  directIndexByTurnKey: Map<string, number>;
  firstIndexByBaseTurnKey: Map<string, number>;
}

const userTurnKeyIndexCache = new WeakMap<ThreadDisplayEntry[], UserTurnKeyIndex>();

function userTurnKeyIndex(entries: ThreadDisplayEntry[]): UserTurnKeyIndex {
  const cached = userTurnKeyIndexCache.get(entries);
  if (cached) {
    return cached;
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  const directIndexByTurnKey = new Map<string, number>();
  const firstIndexByBaseTurnKey = new Map<string, number>();
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
    const index = keys.length - 1;
    directIndexByTurnKey.set(turnKey, index);
    const base = baseTurnKey(turnKey);
    if (!firstIndexByBaseTurnKey.has(base)) {
      firstIndexByBaseTurnKey.set(base, index);
    }
  }
  const index: UserTurnKeyIndex = {
    keys,
    directIndexByTurnKey,
    firstIndexByBaseTurnKey,
  };
  userTurnKeyIndexCache.set(entries, index);
  return index;
}

function anchorIndex(index: UserTurnKeyIndex, currentTurnKey?: string | null): number {
  const keys = index.keys;
  if (keys.length === 0) {
    return -1;
  }
  if (!currentTurnKey || !currentTurnKey.trim()) {
    return keys.length - 1;
  }
  const normalizedCurrent = currentTurnKey.trim();
  const directIndex = index.directIndexByTurnKey.get(normalizedCurrent);
  if (typeof directIndex === "number") {
    return directIndex;
  }
  const base = baseTurnKey(normalizedCurrent);
  const sameTurnIndex = index.firstIndexByBaseTurnKey.get(base);
  return typeof sameTurnIndex === "number" ? sameTurnIndex : keys.length - 1;
}

export function buildPromptJumpControls(
  navigation: PromptNavigationTarget,
  scrollTargets?: {
    up_scroll_top_px?: number | null;
    down_scroll_top_px?: number | null;
  },
): PromptJumpControls {
  return {
    placement: "left-of-send-voice",
    up_turn_key: navigation.previous_turn_key,
    down_turn_key: navigation.next_turn_key,
    up_scroll_top_px: Number.isFinite(scrollTargets?.up_scroll_top_px)
      ? Number(scrollTargets?.up_scroll_top_px)
      : null,
    down_scroll_top_px: Number.isFinite(scrollTargets?.down_scroll_top_px)
      ? Number(scrollTargets?.down_scroll_top_px)
      : null,
    can_jump_up: Boolean(navigation.previous_turn_key),
    can_jump_down: Boolean(navigation.next_turn_key),
    up_action: "jump-prev-user-message",
    down_action: "jump-next-user-message",
  };
}

export function buildPromptNavigationTarget(
  entries: ThreadDisplayEntry[],
  currentTurnKey?: string | null,
): PromptNavigationTarget {
  const keyIndex = userTurnKeyIndex(entries);
  const keys = keyIndex.keys;
  if (keys.length === 0) {
    return {
      previous_turn_key: null,
      next_turn_key: null,
      user_turn_keys: [],
    };
  }
  const index = anchorIndex(keyIndex, currentTurnKey);
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
