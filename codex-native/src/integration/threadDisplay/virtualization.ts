import type { ThreadDisplayEntry, ThreadVirtualWindow, ThreadViewportState } from "./types.js";

const DEFAULT_ROW_HEIGHT_PX = 132;
const DEFAULT_OVERSCAN_ROWS = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lowerBound(offsets: number[], target: number): number {
  let left = 0;
  let right = offsets.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (offsets[middle]! < target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }
  return left;
}

export function buildThreadVirtualWindow(options: {
  entries: ThreadDisplayEntry[];
  viewport?: ThreadViewportState;
  measuredHeightsPx?: Readonly<Record<string, number>>;
  defaultRowHeightPx?: number;
  overscanRows?: number;
}): ThreadVirtualWindow {
  const entries = options.entries;
  const count = entries.length;
  const fallbackHeight = Math.max(48, Math.round(options.defaultRowHeightPx ?? DEFAULT_ROW_HEIGHT_PX));
  const overscanRows = Math.max(1, Math.round(options.overscanRows ?? DEFAULT_OVERSCAN_ROWS));

  if (count === 0) {
    return {
      start_index: 0,
      end_index_exclusive: 0,
      top_spacer_px: 0,
      bottom_spacer_px: 0,
      estimated_total_height_px: 0,
    };
  }

  const heights = entries.map((entry) => {
    const measured = options.measuredHeightsPx?.[entry.entry_id];
    return Number.isFinite(measured) && measured! > 0 ? Math.round(measured!) : fallbackHeight;
  });

  const offsets: number[] = new Array(count);
  let running = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index] = running;
    running += heights[index] ?? fallbackHeight;
  }
  const totalHeight = running;

  const viewport = options.viewport;
  if (!viewport || viewport.viewport_height_px <= 0) {
    return {
      start_index: 0,
      end_index_exclusive: count,
      top_spacer_px: 0,
      bottom_spacer_px: 0,
      estimated_total_height_px: totalHeight,
    };
  }

  const maxScroll = Math.max(0, totalHeight - viewport.viewport_height_px);
  const scrollTop = clamp(Math.round(viewport.scroll_top_px), 0, maxScroll);
  const scrollBottom = scrollTop + viewport.viewport_height_px;

  const start = lowerBound(offsets, Math.max(0, scrollTop));
  const end = Math.max(start + 1, lowerBound(offsets, scrollBottom) + 1);

  const startIndex = Math.max(0, start - overscanRows);
  const endIndex = Math.min(count, end + overscanRows);

  const topSpacer = offsets[startIndex] ?? 0;
  const endOffset = offsets[endIndex] ?? totalHeight;
  const bottomSpacer = Math.max(0, totalHeight - endOffset);

  return {
    start_index: startIndex,
    end_index_exclusive: endIndex,
    top_spacer_px: topSpacer,
    bottom_spacer_px: bottomSpacer,
    estimated_total_height_px: totalHeight,
  };
}
