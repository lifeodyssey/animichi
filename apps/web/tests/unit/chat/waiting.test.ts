import { describe, expect, it } from "vitest";
import { WAITING_THRESHOLDS, waitingPhase } from "../../../src/features/chat/waiting";

describe("waitingPhase escalation (states spec B2a→B2b→B2c)", () => {
  it.each([
    [0, "B2a"],
    [999, "B2a"],
    [1000, "B2b"],
    [3999, "B2b"],
    [4000, "B2c"],
    [12000, "B2c"],
  ] as const)("maps %ims of elapsed waiting to %s", (elapsedMs, phase) => {
    expect(waitingPhase(elapsedMs)).toBe(phase);
  });

  it("keeps the pipeline threshold below the mood threshold", () => {
    expect(WAITING_THRESHOLDS.pipeline).toBeLessThan(WAITING_THRESHOLDS.mood);
  });
});
