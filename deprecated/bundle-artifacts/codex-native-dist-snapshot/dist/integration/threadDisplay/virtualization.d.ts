import type { ThreadDisplayEntry, ThreadVirtualWindow, ThreadViewportState } from "./types.js";
export declare function buildThreadVirtualWindow(options: {
    entries: ThreadDisplayEntry[];
    viewport?: ThreadViewportState;
    measuredHeightsPx?: Readonly<Record<string, number>>;
    defaultRowHeightPx?: number;
    overscanRows?: number;
}): ThreadVirtualWindow;
//# sourceMappingURL=virtualization.d.ts.map