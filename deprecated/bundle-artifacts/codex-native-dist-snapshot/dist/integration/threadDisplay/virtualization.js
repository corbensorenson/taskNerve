const DEFAULT_ROW_HEIGHT_PX = 132;
const DEFAULT_OVERSCAN_ROWS = 6;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function lowerBound(offsets, target) {
    let left = 0;
    let right = offsets.length;
    while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (offsets[middle] < target) {
            left = middle + 1;
        }
        else {
            right = middle;
        }
    }
    return left;
}
function hasMeasuredHeights(measuredHeightsPx) {
    if (!measuredHeightsPx) {
        return false;
    }
    for (const key in measuredHeightsPx) {
        if (Object.prototype.hasOwnProperty.call(measuredHeightsPx, key)) {
            return true;
        }
    }
    return false;
}
let measuredLayoutCache = null;
function measuredLayoutFor(options) {
    const cached = measuredLayoutCache;
    if (cached &&
        cached.entries === options.entries &&
        cached.measuredHeightsPx === options.measuredHeightsPx &&
        cached.fallbackHeight === options.fallbackHeight) {
        return cached;
    }
    const offsets = new Array(options.entries.length);
    let running = 0;
    for (let index = 0; index < options.entries.length; index += 1) {
        offsets[index] = running;
        const measured = options.measuredHeightsPx[options.entries[index].entry_id];
        running +=
            Number.isFinite(measured) && measured > 0 ? Math.round(measured) : options.fallbackHeight;
    }
    measuredLayoutCache = {
        entries: options.entries,
        measuredHeightsPx: options.measuredHeightsPx,
        fallbackHeight: options.fallbackHeight,
        offsets,
        totalHeight: running,
    };
    return measuredLayoutCache;
}
export function buildThreadVirtualWindow(options) {
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
    const viewport = options.viewport;
    const measuredHeightsPx = options.measuredHeightsPx;
    if (!hasMeasuredHeights(measuredHeightsPx)) {
        const totalHeight = count * fallbackHeight;
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
        const start = Math.ceil(Math.max(0, scrollTop) / fallbackHeight);
        const end = Math.max(start + 1, Math.ceil(scrollBottom / fallbackHeight) + 1);
        const startIndex = Math.max(0, start - overscanRows);
        const endIndex = Math.min(count, end + overscanRows);
        const topSpacer = startIndex * fallbackHeight;
        const bottomSpacer = Math.max(0, totalHeight - endIndex * fallbackHeight);
        return {
            start_index: startIndex,
            end_index_exclusive: endIndex,
            top_spacer_px: topSpacer,
            bottom_spacer_px: bottomSpacer,
            estimated_total_height_px: totalHeight,
        };
    }
    const layout = measuredLayoutFor({
        entries,
        measuredHeightsPx,
        fallbackHeight,
    });
    if (!viewport || viewport.viewport_height_px <= 0) {
        return {
            start_index: 0,
            end_index_exclusive: count,
            top_spacer_px: 0,
            bottom_spacer_px: 0,
            estimated_total_height_px: layout.totalHeight,
        };
    }
    const maxScroll = Math.max(0, layout.totalHeight - viewport.viewport_height_px);
    const scrollTop = clamp(Math.round(viewport.scroll_top_px), 0, maxScroll);
    const scrollBottom = scrollTop + viewport.viewport_height_px;
    const start = lowerBound(layout.offsets, Math.max(0, scrollTop));
    const end = Math.max(start + 1, lowerBound(layout.offsets, scrollBottom) + 1);
    const startIndex = Math.max(0, start - overscanRows);
    const endIndex = Math.min(count, end + overscanRows);
    const topSpacer = layout.offsets[startIndex] ?? 0;
    const endOffset = layout.offsets[endIndex] ?? layout.totalHeight;
    const bottomSpacer = Math.max(0, layout.totalHeight - endOffset);
    return {
        start_index: startIndex,
        end_index_exclusive: endIndex,
        top_spacer_px: topSpacer,
        bottom_spacer_px: bottomSpacer,
        estimated_total_height_px: layout.totalHeight,
    };
}
//# sourceMappingURL=virtualization.js.map