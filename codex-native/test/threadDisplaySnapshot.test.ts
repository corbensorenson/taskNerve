import { describe, expect, it } from "vitest";

import {
  buildThreadDisplaySnapshot,
  buildThreadVirtualWindow,
  decideThreadScrollBehavior,
  extractThreadDisplayEntries,
} from "../src/integration/threadDisplay/index.js";

describe("thread display integration", () => {
  it("extracts both message and action entries with stable timestamps", () => {
    const entries = extractThreadDisplayEntries({
      conversation: {
        turns: [
          {
            id: "t1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "Prompt" }],
            output_items: [
              { type: "tool_call", name: "exec", detail: "git status" },
              { type: "message", text: "Result" },
            ],
          },
        ],
      },
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "action", "message"]);
    expect(entries.every((entry) => entry.timestamp_label.length > 0)).toBe(true);
  });

  it("does not drag the user down while reading away from bottom", () => {
    const decision = decideThreadScrollBehavior({
      previousEntryCount: 3,
      nextEntryCount: 4,
      previousViewport: {
        scroll_top_px: 280,
        scroll_height_px: 1800,
        viewport_height_px: 600,
      },
      nextViewport: {
        scroll_top_px: 280,
        scroll_height_px: 2100,
        viewport_height_px: 600,
      },
    });

    expect(decision.mode).toBe("no-op");
  });

  it("preserves visual offset when history is prepended near the top", () => {
    const decision = decideThreadScrollBehavior({
      previousEntryCount: 20,
      nextEntryCount: 30,
      historyPrependedLikely: true,
      previousViewport: {
        scroll_top_px: 32,
        scroll_height_px: 1600,
        viewport_height_px: 640,
      },
      nextViewport: {
        scroll_top_px: 32,
        scroll_height_px: 2240,
        viewport_height_px: 640,
      },
    });

    expect(decision.mode).toBe("preserve-offset");
    expect(decision.scroll_top_px).toBe(672);
  });

  it("does not preserve offset near top when new entries are appended", () => {
    const decision = decideThreadScrollBehavior({
      previousEntryCount: 20,
      nextEntryCount: 30,
      historyPrependedLikely: false,
      previousViewport: {
        scroll_top_px: 32,
        scroll_height_px: 1600,
        viewport_height_px: 640,
      },
      nextViewport: {
        scroll_top_px: 32,
        scroll_height_px: 2240,
        viewport_height_px: 640,
      },
    });

    expect(decision.mode).toBe("no-op");
  });

  it("builds a bounded virtualization window for large threads", () => {
    const entries = Array.from({ length: 240 }, (_unused, index) => ({
      entry_id: `e-${index}`,
      turn_key: `assistant:${index}`,
      turn_id: String(index),
      role: "assistant" as const,
      kind: "message" as const,
      text: `entry ${index}`,
      created_at_utc: null,
      timestamp_label: "",
      timestamp_tooltip: "",
    }));

    const window = buildThreadVirtualWindow({
      entries,
      defaultRowHeightPx: 90,
      viewport: {
        scroll_top_px: 3600,
        scroll_height_px: 21600,
        viewport_height_px: 720,
      },
    });

    expect(window.end_index_exclusive - window.start_index).toBeLessThan(40);
    expect(window.estimated_total_height_px).toBe(21600);
  });

  it("keeps measured virtualization windows stable across interleaved threads", () => {
    const entriesA = Array.from({ length: 80 }, (_unused, index) => ({
      entry_id: `a-${index}`,
      turn_key: `assistant:a-${index}`,
      turn_id: `a-${index}`,
      role: "assistant" as const,
      kind: "message" as const,
      text: `entry a ${index}`,
      created_at_utc: null,
      timestamp_label: "",
      timestamp_tooltip: "",
    }));
    const entriesB = Array.from({ length: 80 }, (_unused, index) => ({
      entry_id: `b-${index}`,
      turn_key: `assistant:b-${index}`,
      turn_id: `b-${index}`,
      role: "assistant" as const,
      kind: "message" as const,
      text: `entry b ${index}`,
      created_at_utc: null,
      timestamp_label: "",
      timestamp_tooltip: "",
    }));

    const measuredA: Record<string, number> = {
      "a-0": 120,
      "a-1": 140,
      "a-2": 88,
    };
    const measuredB: Record<string, number> = {
      "b-0": 150,
      "b-1": 96,
      "b-2": 132,
    };

    const firstA = buildThreadVirtualWindow({
      entries: entriesA,
      measuredHeightsPx: measuredA,
      defaultRowHeightPx: 100,
      viewport: {
        scroll_top_px: 900,
        scroll_height_px: 8000,
        viewport_height_px: 600,
      },
    });
    buildThreadVirtualWindow({
      entries: entriesB,
      measuredHeightsPx: measuredB,
      defaultRowHeightPx: 100,
      viewport: {
        scroll_top_px: 1100,
        scroll_height_px: 8000,
        viewport_height_px: 600,
      },
    });
    const secondA = buildThreadVirtualWindow({
      entries: entriesA,
      measuredHeightsPx: measuredA,
      defaultRowHeightPx: 100,
      viewport: {
        scroll_top_px: 900,
        scroll_height_px: 8000,
        viewport_height_px: 600,
      },
    });

    expect(secondA).toEqual(firstA);
  });

  it("builds prompt-history navigation targets for up/down controls", () => {
    const snapshot = buildThreadDisplaySnapshot({
      thread: {
        conversation: {
          turns: [
            {
              id: "t1",
              created_at: "2026-03-10T09:00:00.000Z",
              input_items: [{ type: "message", text: "one" }],
              output_items: [{ type: "message", text: "a" }],
            },
            {
              id: "t2",
              created_at: "2026-03-10T09:01:00.000Z",
              input_items: [{ type: "message", text: "two" }],
              output_items: [{ type: "message", text: "b" }],
            },
            {
              id: "t3",
              created_at: "2026-03-10T09:02:00.000Z",
              input_items: [{ type: "message", text: "three" }],
              output_items: [{ type: "message", text: "c" }],
            },
          ],
        },
      },
      current_turn_key: "assistant:t2",
    });

    expect(snapshot.prompt_navigation.previous_turn_key).toBe("user:t1");
    expect(snapshot.prompt_navigation.next_turn_key).toBe("user:t3");
    expect(snapshot.jump_controls.placement).toBe("left-of-send-voice");
    expect(snapshot.jump_controls.up_action).toBe("jump-prev-user-message");
    expect(snapshot.jump_controls.down_action).toBe("jump-next-user-message");
  });

  it("reuses thread-display snapshot objects when inputs are unchanged", () => {
    const thread = {
      conversation: {
        turns: [
          {
            id: "t1",
            created_at: "2026-03-10T09:00:00.000Z",
            input_items: [{ type: "message", text: "hello" }],
            output_items: [{ type: "message", text: "world" }],
          },
        ],
      },
    };
    const first = buildThreadDisplaySnapshot({
      thread,
      generated_at_utc: "2026-03-10T09:05:00.000Z",
      current_turn_key: "assistant:t1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 260,
        viewport_height_px: 200,
      },
    });
    const second = buildThreadDisplaySnapshot({
      thread,
      generated_at_utc: "2026-03-10T09:05:00.000Z",
      current_turn_key: "assistant:t1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 260,
        viewport_height_px: 200,
      },
    });

    expect(second).toBe(first);
    expect(second.entries).toBe(first.entries);
    expect(second.virtual_window).toBe(first.virtual_window);
  });

  it("invalidates entry extraction cache when turns mutate in place", () => {
    const thread = {
      conversation: {
        turns: [
          {
            id: "t1",
            created_at: "2026-03-10T09:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
        ],
      },
    };

    const first = extractThreadDisplayEntries(thread, "2026-03-10T09:05:00.000Z");
    thread.conversation.turns.push({
      id: "t2",
      created_at: "2026-03-10T09:01:00.000Z",
      input_items: [{ type: "message", text: "two" }],
      output_items: [{ type: "message", text: "b" }],
    });
    const second = extractThreadDisplayEntries(thread, "2026-03-10T09:05:00.000Z");

    expect(second).not.toBe(first);
    expect(second).toHaveLength(4);
  });

  it("reuses extracted entries when wrapper objects change but turn array stays stable", () => {
    const turns = [
      {
        id: "t1",
        created_at: "2026-03-10T09:00:00.000Z",
        input_items: [{ type: "message", text: "one" }],
        output_items: [{ type: "message", text: "a" }],
      },
      {
        id: "t2",
        created_at: "2026-03-10T09:01:00.000Z",
        input_items: [{ type: "message", text: "two" }],
        output_items: [{ type: "message", text: "b" }],
      },
    ];

    const first = extractThreadDisplayEntries(
      {
        conversation: {
          turns,
        },
      },
      "2026-03-10T09:05:00.000Z",
    );
    const second = extractThreadDisplayEntries(
      {
        thread: {
          turns,
        },
      },
      "2026-03-10T09:05:00.000Z",
    );

    expect(second).toBe(first);
  });

  it("reuses extracted entries when wrapper objects change but turn mapping stays stable", () => {
    const turnMapping = {
      turn_1: {
        turn: {
          id: "t1",
          created_at: "2026-03-10T09:00:00.000Z",
          input_items: [{ type: "message", text: "one" }],
          output_items: [{ type: "message", text: "a" }],
        },
      },
      turn_2: {
        turn: {
          id: "t2",
          created_at: "2026-03-10T09:01:00.000Z",
          input_items: [{ type: "message", text: "two" }],
          output_items: [{ type: "message", text: "b" }],
        },
      },
    };

    const first = extractThreadDisplayEntries(
      {
        conversation: {
          turn_mapping: turnMapping,
        },
      },
      "2026-03-10T09:05:00.000Z",
    );
    const second = extractThreadDisplayEntries(
      {
        turn_mapping: turnMapping,
      },
      "2026-03-10T09:05:00.000Z",
    );

    expect(second).toBe(first);
  });

  it("reuses display snapshots when wrapper objects share the same turn collection", () => {
    const turns = [
      {
        id: "t1",
        created_at: "2026-03-10T09:00:00.000Z",
        input_items: [{ type: "message", text: "one" }],
        output_items: [{ type: "message", text: "a" }],
      },
    ];

    const first = buildThreadDisplaySnapshot({
      thread: {
        conversation: {
          turns,
        },
      },
      current_turn_key: "assistant:t1",
    });
    const second = buildThreadDisplaySnapshot({
      thread: {
        thread: {
          turns,
        },
      },
      current_turn_key: "assistant:t1",
    });

    expect(second).toBe(first);
  });

  it("reuses per-thread snapshots across interleaved thread rendering", () => {
    const threadA = {
      conversation: {
        turns: [
          {
            id: "a1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "hello a" }],
            output_items: [{ type: "message", text: "world a" }],
          },
        ],
      },
    };
    const threadB = {
      conversation: {
        turns: [
          {
            id: "b1",
            created_at: "2026-03-10T10:01:00.000Z",
            input_items: [{ type: "message", text: "hello b" }],
            output_items: [{ type: "message", text: "world b" }],
          },
        ],
      },
    };

    const firstA = buildThreadDisplaySnapshot({
      thread: threadA,
      generated_at_utc: "2026-03-10T10:05:00.000Z",
      current_turn_key: "assistant:a1",
    });
    buildThreadDisplaySnapshot({
      thread: threadB,
      generated_at_utc: "2026-03-10T10:05:00.000Z",
      current_turn_key: "assistant:b1",
    });
    const secondA = buildThreadDisplaySnapshot({
      thread: threadA,
      generated_at_utc: "2026-03-10T10:05:00.000Z",
      current_turn_key: "assistant:a1",
    });

    expect(secondA).toBe(firstA);
  });

  it("avoids downward scroll jumps when appending new turns while near top", () => {
    const thread = {
      conversation: {
        turns: [
          {
            id: "t1",
            created_at: "2026-03-10T09:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "t2",
            created_at: "2026-03-10T09:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
    };

    const first = buildThreadDisplaySnapshot({
      thread,
      generated_at_utc: "2026-03-10T09:05:00.000Z",
      viewport: {
        scroll_top_px: 32,
        scroll_height_px: 1600,
        viewport_height_px: 640,
      },
    });
    thread.conversation.turns.push({
      id: "t3",
      created_at: "2026-03-10T09:02:00.000Z",
      input_items: [{ type: "message", text: "three" }],
      output_items: [{ type: "message", text: "c" }],
    });
    const second = buildThreadDisplaySnapshot({
      thread,
      generated_at_utc: "2026-03-10T09:05:00.000Z",
      previous_entry_count: first.entries.length,
      previous_viewport: {
        scroll_top_px: 32,
        scroll_height_px: 1600,
        viewport_height_px: 640,
      },
      viewport: {
        scroll_top_px: 32,
        scroll_height_px: 2240,
        viewport_height_px: 640,
      },
    });

    expect(second.scroll_decision.mode).toBe("no-op");
  });
});
