import { describe, expect, it } from "vitest";

import { buildCodexConversationDisplaySnapshot } from "../src/integration/codexConversationDisplay.js";

describe("codex conversation display", () => {
  it("provides Codex-first display contract with camelCase fields", () => {
    const snapshot = buildCodexConversationDisplaySnapshot({
      thread: {
        conversation: {
          turns: [
            {
              id: "t1",
              created_at: "2026-03-10T13:00:00.000Z",
              input_items: [{ type: "message", text: "one" }],
              output_items: [{ type: "message", text: "two" }],
            },
          ],
        },
      },
      currentTurnKey: "assistant:t1",
      focusTurnKey: "user:t1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 300,
        viewport_height_px: 200,
      },
    });

    expect(snapshot.integrationMode).toBe("codex-native-host");
    expect(snapshot.promptNavigation.previousTurnKey).toBe(null);
    expect(snapshot.promptNavigation.nextTurnKey).toBe(null);
    expect(snapshot.jumpControls.placement).toBe("left-of-send-voice");
    expect(snapshot.jumpControls.upScrollTopPx).toBe(null);
    expect(snapshot.jumpControls.downScrollTopPx).toBe(null);
    expect(snapshot.jumpControls.upAction).toBe("jump-prev-user-message");
    expect(snapshot.jumpControls.downAction).toBe("jump-next-user-message");
    expect(snapshot.scrollDecision.mode).toBe("jump-to-turn");
    expect(snapshot.scrollDecision.turn_key).toBe("user:t1");
  });

  it("reuses converted snapshots when display inputs are unchanged", () => {
    const thread = {
      conversation: {
        turns: [
          {
            id: "t1",
            created_at: "2026-03-10T13:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "two" }],
          },
        ],
      },
    };
    const first = buildCodexConversationDisplaySnapshot({
      thread,
      generatedAtUtc: "2026-03-10T13:05:00.000Z",
      currentTurnKey: "assistant:t1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 300,
        viewport_height_px: 200,
      },
    });
    const second = buildCodexConversationDisplaySnapshot({
      thread,
      generatedAtUtc: "2026-03-10T13:05:00.000Z",
      currentTurnKey: "assistant:t1",
      viewport: {
        scroll_top_px: 0,
        scroll_height_px: 300,
        viewport_height_px: 200,
      },
    });

    expect(second).toBe(first);
  });

  it("reuses converted snapshots across interleaved thread snapshots", () => {
    const threadA = {
      conversation: {
        turns: [
          {
            id: "t-a",
            created_at: "2026-03-10T13:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "two" }],
          },
        ],
      },
    };
    const threadB = {
      conversation: {
        turns: [
          {
            id: "t-b",
            created_at: "2026-03-10T13:01:00.000Z",
            input_items: [{ type: "message", text: "three" }],
            output_items: [{ type: "message", text: "four" }],
          },
        ],
      },
    };

    const firstA = buildCodexConversationDisplaySnapshot({
      thread: threadA,
      generatedAtUtc: "2026-03-10T13:05:00.000Z",
      currentTurnKey: "assistant:t-a",
    });
    buildCodexConversationDisplaySnapshot({
      thread: threadB,
      generatedAtUtc: "2026-03-10T13:05:00.000Z",
      currentTurnKey: "assistant:t-b",
    });
    const secondA = buildCodexConversationDisplaySnapshot({
      thread: threadA,
      generatedAtUtc: "2026-03-10T13:05:00.000Z",
      currentTurnKey: "assistant:t-a",
    });

    expect(secondA).toBe(firstA);
  });
});
