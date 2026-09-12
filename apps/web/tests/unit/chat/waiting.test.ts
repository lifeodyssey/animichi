import { describe, expect, it } from "vitest";
import { waitingPhase } from "../../../src/features/chat/waiting";

describe("waiting feedback timing", () => {
  it.each([
    [0, "waiting"],
    [1000, "waiting"],
    [4000, "waiting"],
    [14_999, "waiting"],
    [15_000, "extended"],
    [60_000, "extended"],
  ] as const)("shows %s ms as %s without invented intermediate steps", (elapsedMs, phase) => {
    expect(waitingPhase(elapsedMs)).toBe(phase);
  });
});
