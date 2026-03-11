import type { ThreadScrollDecision, ThreadViewportState } from "./types.js";

// Keep this tight so "almost at bottom" readers are not force-pulled downward.
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;
const PRESERVE_OFFSET_TOP_THRESHOLD_PX = 120;

function nearBottom(viewport: ThreadViewportState): boolean {
  const distanceFromBottom = viewport.scroll_height_px - (viewport.scroll_top_px + viewport.viewport_height_px);
  return distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
}

function maxScrollTop(viewport: ThreadViewportState): number {
  return Math.max(0, viewport.scroll_height_px - viewport.viewport_height_px);
}

function nearTop(viewport: ThreadViewportState): boolean {
  return viewport.scroll_top_px <= PRESERVE_OFFSET_TOP_THRESHOLD_PX;
}

export function decideThreadScrollBehavior(options: {
  previousViewport?: ThreadViewportState;
  nextViewport?: ThreadViewportState;
  previousEntryCount?: number;
  nextEntryCount?: number;
  focusTurnKey?: string | null;
  historyPrependedLikely?: boolean;
}): ThreadScrollDecision {
  const focusTurnKey = options.focusTurnKey?.trim();
  if (focusTurnKey) {
    return {
      mode: "jump-to-turn",
      turn_key: focusTurnKey,
      behavior: "smooth",
    };
  }

  const previousViewport = options.previousViewport;
  const nextViewport = options.nextViewport;
  if (!previousViewport || !nextViewport) {
    return { mode: "no-op" };
  }

  const previousCount = Number(options.previousEntryCount ?? 0);
  const nextCount = Number(options.nextEntryCount ?? 0);
  if (nextCount <= previousCount) {
    return { mode: "no-op" };
  }

  if (nearBottom(previousViewport)) {
    return {
      mode: "stick-to-bottom",
      scroll_top_px: maxScrollTop(nextViewport),
    };
  }

  const delta = nextViewport.scroll_height_px - previousViewport.scroll_height_px;
  if (!Number.isFinite(delta) || delta <= 0) {
    return { mode: "no-op" };
  }

  // While users are reading history away from both edges, keep their manual position stable.
  // Preserve offset only when older history is likely prepended near the top.
  if (!nearTop(previousViewport)) {
    return { mode: "no-op" };
  }

  if (options.historyPrependedLikely === false) {
    return { mode: "no-op" };
  }

  return {
    mode: "preserve-offset",
    delta_px: delta,
    scroll_top_px: Math.max(0, previousViewport.scroll_top_px + delta),
  };
}
