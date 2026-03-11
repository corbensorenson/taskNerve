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

  it("preserves reading position when new entries stream in while user is not at bottom", () => {
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

    expect(decision.mode).toBe("preserve-offset");
    expect(decision.scroll_top_px).toBe(580);
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
  });
});
