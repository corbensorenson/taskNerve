import { describe, expect, it, vi } from "vitest";

import type { CodexHostServices } from "../src/host/codexHostServices.js";
import {
  readRequestedModelTransportMode,
  resolveModelTransportPlan,
  startTurnWithResolvedModelTransport,
} from "../src/integration/modelTransport.js";

function makeHost(overrides: Partial<CodexHostServices> = {}): CodexHostServices {
  return {
    getActiveWorkspaceContext: vi.fn(async () => ({ repoRoot: "/tmp/repo" })),
    listProjectThreads: vi.fn(async () => []),
    startThread: vi.fn(async () => ({ thread_id: "thread-1" })),
    startTurn: vi.fn(async () => ({ ok: true })),
    setThreadName: vi.fn(async () => ({ ok: true })),
    setThreadModel: vi.fn(async () => ({ ok: true })),
    pinThread: vi.fn(async () => ({ ok: true })),
    openThread: vi.fn(async () => ({ ok: true })),
    readRepositorySettings: vi.fn(async () => ({})),
    writeRepositorySettings: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("model transport", () => {
  it("defaults to auto when env is missing", () => {
    expect(readRequestedModelTransportMode({})).toBe("auto");
  });

  it("reads legacy transport env key alias", () => {
    expect(
      readRequestedModelTransportMode({
        TASKNERVE_MODEL_TRANSPORT_MODE: "websocket",
      }),
    ).toBe("websocket");
  });

  it("falls back to http when websocket is requested but host support is missing", () => {
    const host = makeHost();
    const plan = resolveModelTransportPlan(host, {
      TASKNERVE_MODEL_TRANSPORT: "websocket",
    });

    expect(plan.requested_mode).toBe("websocket");
    expect(plan.resolved_mode).toBe("http");
    expect(plan.websocket_available).toBe(false);
    expect(plan.fallback_reason).toContain("unavailable");
  });

  it("uses websocket transport in auto mode when host support exists", async () => {
    const host = makeHost({
      startTurnWebSocket: vi.fn(async () => ({ ok: true })),
    });
    const payload = { thread_id: "thread-1", prompt: "hi" };
    const result = await startTurnWithResolvedModelTransport(host, payload, {
      TASKNERVE_MODEL_TRANSPORT: "auto",
    });

    expect(result.executed_mode).toBe("websocket");
    expect(result.fell_back_to_http).toBe(false);
    expect(result.websocket_error).toBeNull();
    expect(host.startTurnWebSocket).toHaveBeenCalledWith(payload);
    expect(host.startTurn).not.toHaveBeenCalled();
  });

  it("honors explicit runtime override to force http transport", async () => {
    const host = makeHost({
      startTurnWebSocket: vi.fn(async () => ({ ok: true })),
    });
    const payload = { thread_id: "thread-1", prompt: "hi" };
    const result = await startTurnWithResolvedModelTransport(
      host,
      payload,
      {
        TASKNERVE_MODEL_TRANSPORT: "auto",
      },
      {
        requestedMode: "http",
      },
    );

    expect(result.plan.requested_mode).toBe("http");
    expect(result.plan.resolved_mode).toBe("http");
    expect(result.executed_mode).toBe("http");
    expect(host.startTurn).toHaveBeenCalledWith(payload);
    expect(host.startTurnWebSocket).not.toHaveBeenCalled();
  });

  it("falls back to http when websocket start fails", async () => {
    const host = makeHost({
      startTurnWebSocket: vi.fn(async () => {
        throw new Error("socket closed");
      }),
    });
    const payload = { thread_id: "thread-1", prompt: "hi" };
    const result = await startTurnWithResolvedModelTransport(host, payload, {
      TASKNERVE_MODEL_TRANSPORT: "websocket",
    });

    expect(result.executed_mode).toBe("http");
    expect(result.fell_back_to_http).toBe(true);
    expect(result.websocket_error).toContain("socket closed");
    expect(host.startTurnWebSocket).toHaveBeenCalledWith(payload);
    expect(host.startTurn).toHaveBeenCalledWith(payload);
  });
});
