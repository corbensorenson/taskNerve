import { buildPromptNavigationTarget } from "./navigation.js";
import { extractThreadDisplayEntries } from "./extract.js";
import { decideThreadScrollBehavior } from "./scrollPolicy.js";
import type { BuildThreadDisplayOptions, ThreadDisplaySnapshot } from "./types.js";
import { buildThreadVirtualWindow } from "./virtualization.js";

export function buildThreadDisplaySnapshot(
  options: BuildThreadDisplayOptions,
): ThreadDisplaySnapshot {
  const entries = extractThreadDisplayEntries(options.thread);
  const promptNavigation = buildPromptNavigationTarget(entries, options.current_turn_key ?? null);
  const virtualWindow = buildThreadVirtualWindow({
    entries,
    viewport: options.viewport,
    measuredHeightsPx: options.measured_heights_px,
    defaultRowHeightPx: options.default_row_height_px,
  });
  const scrollDecision = decideThreadScrollBehavior({
    previousViewport: options.previous_viewport,
    nextViewport: options.viewport,
    previousEntryCount: options.previous_entry_count,
    nextEntryCount: entries.length,
    focusTurnKey: options.focus_turn_key,
  });

  return {
    integration_mode: "codex-native-host",
    entries,
    prompt_navigation: promptNavigation,
    virtual_window: virtualWindow,
    scroll_decision: scrollDecision,
  };
}
