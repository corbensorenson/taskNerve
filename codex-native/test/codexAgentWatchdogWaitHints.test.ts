import { describe, expect, it } from "vitest";

import {
  parseWaitHintDetailsFromText,
  parseWaitHintFromText,
  statusSuggestsWaiting,
} from "../src/integration/codexAgentWatchdogWaitHints.js";

describe("codexAgentWatchdog wait hints", () => {
  it("detects waiting states from thread status text", () => {
    expect(statusSuggestsWaiting("waiting-for-job")).toBe(true);
    expect(statusSuggestsWaiting("retrying after backoff")).toBe(true);
    expect(statusSuggestsWaiting("done")).toBe(false);
  });

  it("detects explicit waiting phrases in output text", () => {
    expect(
      parseWaitHintFromText("Monitoring training run now. This may take 30 minutes."),
    ).toBe(true);
    expect(parseWaitHintFromText("Will update when deploy completes.")).toBe(true);
  });

  it("uses verb+duration fallback for long-running work", () => {
    expect(parseWaitHintFromText("sleeping before retry in 45s")).toBe(true);
    expect(parseWaitHintFromText("polling build for 2m")).toBe(true);
    expect(parseWaitHintFromText("wrote patch and finished task")).toBe(false);
  });

  it("extracts deterministic wait durations from message text", () => {
    expect(
      parseWaitHintDetailsFromText("Monitoring training run now. This may take 30 minutes."),
    ).toEqual({
      suggests_wait: true,
      duration_minutes: 30,
    });
    expect(
      parseWaitHintDetailsFromText("Still waiting on integration tests, poll again in 1h 20m."),
    ).toEqual({
      suggests_wait: true,
      duration_minutes: 80,
    });
    expect(parseWaitHintDetailsFromText("Task is done and pushed.")).toEqual({
      suggests_wait: false,
      duration_minutes: null,
    });
  });
});
