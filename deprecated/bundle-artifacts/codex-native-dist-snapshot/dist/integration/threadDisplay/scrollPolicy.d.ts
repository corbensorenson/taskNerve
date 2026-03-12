import type { ThreadScrollDecision, ThreadViewportState } from "./types.js";
export declare function decideThreadScrollBehavior(options: {
    previousViewport?: ThreadViewportState;
    nextViewport?: ThreadViewportState;
    previousEntryCount?: number;
    nextEntryCount?: number;
    focusTurnKey?: string | null;
}): ThreadScrollDecision;
//# sourceMappingURL=scrollPolicy.d.ts.map