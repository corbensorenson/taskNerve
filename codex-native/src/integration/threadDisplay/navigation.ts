import type { PromptNavigationTarget, ThreadDisplayEntry } from "./types.js";

function baseTurnKey(value: string): string {
  return value.replace(/^(user|assistant):/i, "").trim();
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    result.push(value);
  });
  return result;
}

function userTurnKeys(entries: ThreadDisplayEntry[]): string[] {
  return uniqueInOrder(
    entries
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.turn_key)
      .map((turnKey) => (turnKey.startsWith("user:") ? turnKey : `user:${baseTurnKey(turnKey)}`)),
  );
}

function anchorIndex(keys: string[], currentTurnKey?: string | null): number {
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

export function buildPromptNavigationTarget(
  entries: ThreadDisplayEntry[],
  currentTurnKey?: string | null,
): PromptNavigationTarget {
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
