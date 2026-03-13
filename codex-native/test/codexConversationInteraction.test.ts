import { describe, expect, it } from "vitest";

import { buildCodexConversationDisplaySnapshot } from "../src/integration/codexConversationDisplay.js";
import { conversationInteractionStep } from "../src/integration/codexConversationInteraction.js";

describe("codex conversation interaction", () => {
  it("returns explicit jump commands for composer up/down actions", () => {
    const snapshot = buildCodexConversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T10:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
    });

    const result = conversationInteractionStep({
      snapshot,
      event: {
        type: "jump-next-user-message",
        nowMs: 1000,
      },
    });

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toMatchObject({
      type: "set-current-turn-key",
      turnKey: "user:turn-2",
      reason: "jump-button",
    });
    expect(result.commands[1]).toMatchObject({
      type: "scroll-to-top",
      scrollTopPx: 264,
      behavior: "smooth",
      reason: "jump-button",
    });
  });

  it("suppresses auto-scroll while user is actively scrolling", () => {
    const snapshot = buildCodexConversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T10:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
      previousEntryCount: 1,
      previousViewport: {
        scroll_top_px: 372,
        scroll_height_px: 900,
        viewport_height_px: 520,
      },
      viewport: {
        scroll_top_px: 372,
        scroll_height_px: 1040,
        viewport_height_px: 520,
      },
    });

    const activeScroll = conversationInteractionStep({
      snapshot,
      event: {
        type: "display-updated",
        viewport: {
          scroll_top_px: 372,
          scroll_height_px: 1040,
          viewport_height_px: 520,
        },
        userScrolling: true,
        nowMs: 1000,
      },
    });

    expect(activeScroll.commands).toHaveLength(0);
  });

  it("does not snap back to bottom immediately after a jump from the tail", () => {
    const snapshot = buildCodexConversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T10:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-2",
      previousEntryCount: 3,
      previousViewport: {
        scroll_top_px: 132,
        scroll_height_px: 396,
        viewport_height_px: 264,
      },
      viewport: {
        scroll_top_px: 132,
        scroll_height_px: 528,
        viewport_height_px: 264,
      },
    });

    const jumped = conversationInteractionStep({
      snapshot,
      state: {
        integrationMode: "codex-native-host",
        currentTurnKey: "assistant:turn-2",
        userScrolling: false,
        viewport: {
          scroll_top_px: 264,
          scroll_height_px: 528,
          viewport_height_px: 264,
        },
        lastScrollCommandAtMs: null,
        lastScrollTopPx: null,
        lastScrollTurnKey: null,
        suppressAutoScrollUntilMs: null,
      },
      event: {
        type: "jump-prev-user-message",
        nowMs: 1000,
      },
    });

    expect(jumped.commands).toHaveLength(2);
    expect(jumped.commands[1]).toMatchObject({
      type: "scroll-to-top",
      scrollTopPx: 0,
      reason: "jump-button",
    });

    const afterJumpDisplay = conversationInteractionStep({
      snapshot,
      state: jumped.state,
      event: {
        type: "display-updated",
        viewport: {
          scroll_top_px: 264,
          scroll_height_px: 528,
          viewport_height_px: 264,
        },
        userScrolling: false,
        nowMs: 1010,
      },
    });

    expect(afterJumpDisplay.commands).toEqual([]);
  });

  it("throttles repeated auto-scroll commands to avoid jitter", () => {
    const snapshot = buildCodexConversationDisplaySnapshot({
      thread: {
        turns: [
          {
            id: "turn-1",
            created_at: "2026-03-10T10:00:00.000Z",
            input_items: [{ type: "message", text: "one" }],
            output_items: [{ type: "message", text: "a" }],
          },
          {
            id: "turn-2",
            created_at: "2026-03-10T10:01:00.000Z",
            input_items: [{ type: "message", text: "two" }],
            output_items: [{ type: "message", text: "b" }],
          },
        ],
      },
      currentTurnKey: "assistant:turn-1",
      previousEntryCount: 1,
      previousViewport: {
        scroll_top_px: 372,
        scroll_height_px: 900,
        viewport_height_px: 520,
      },
      viewport: {
        scroll_top_px: 372,
        scroll_height_px: 1040,
        viewport_height_px: 520,
      },
    });

    const first = conversationInteractionStep({
      snapshot,
      event: {
        type: "user-scroll-end",
        viewport: {
          scroll_top_px: 372,
          scroll_height_px: 1040,
          viewport_height_px: 520,
        },
        nowMs: 1000,
      },
    });

    expect(first.commands).toHaveLength(1);
    expect(first.commands[0]).toMatchObject({
      type: "scroll-to-top",
      scrollTopPx: 520,
      reason: "stick-to-bottom",
    });

    const second = conversationInteractionStep({
      snapshot,
      state: first.state,
      event: {
        type: "display-updated",
        viewport: {
          scroll_top_px: 372,
          scroll_height_px: 1040,
          viewport_height_px: 520,
        },
        userScrolling: false,
        nowMs: 1020,
      },
    });

    expect(second.commands).toHaveLength(0);
  });
});
