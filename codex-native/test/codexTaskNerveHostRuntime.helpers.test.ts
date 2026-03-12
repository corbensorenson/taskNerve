import { describe, expect, it } from "vitest";

import {
  parseBranchState,
  parseTaskCount,
  parseThreadId,
  syncTaskMarker,
} from "../src/integration/codexTaskNerveHostRuntime.helpers.js";

describe("codexTaskNerveHostRuntime helpers", () => {
  it("parses thread identifiers across host payload variants", () => {
    expect(parseThreadId({ thread_id: "thread-1" })).toBe("thread-1");
    expect(parseThreadId({ threadId: "thread-2" })).toBe("thread-2");
    expect(parseThreadId({ thread: { id: "thread-3" } })).toBe("thread-3");
    expect(parseThreadId({ id: "thread-4" })).toBe("thread-4");
    expect(parseThreadId({})).toBeNull();
  });

  it("parses task counts deterministically", () => {
    expect(parseTaskCount(12)).toBe(12);
    expect(parseTaskCount({ task_count: 5 })).toBe(5);
    expect(parseTaskCount({ pendingTaskCount: 7 })).toBe(7);
    expect(parseTaskCount(["a", "b", "c"])).toBe(3);
    expect(parseTaskCount(null)).toBe(0);
  });

  it("builds stable task markers for inflight dedupe keys", () => {
    const marker = syncTaskMarker([
      { task_id: "a", status: "open", claimed_by_agent_id: "agent.1", title: "alpha task" },
      { task_id: "b", status: "claimed", claimed_by_agent_id: "agent.2", title: "beta task" },
      { task_id: "c", status: "done", claimed_by_agent_id: "agent.3", title: "gamma task" },
    ]);
    expect(marker).toContain("3|");
    expect(marker).toContain("a:open:agent.1:alpha task");
    expect(marker).toContain("c:done:agent.3:gamma task");
  });

  it("normalizes branch snapshots", () => {
    expect(
      parseBranchState({
        current_branch: "tasknerve/main",
        branches: ["tasknerve/main", "feature/a"],
      }),
    ).toEqual({
      currentBranch: "tasknerve/main",
      branches: ["tasknerve/main", "feature/a"],
    });
  });
});
