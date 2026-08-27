import { describe, expect, it, vi } from "vitest";
import { gatedTurnEntry, isTurnActive } from "../../../src/features/chat/lib/turn-gate";

describe("isTurnActive: the shared status gate's verdict (W1 #1220)", () => {
  it.each([
    ["submitted", true],
    ["streaming", true],
    ["ready", false],
    ["error", false],
  ] as const)("treats %s as active=%s", (status, expected) => {
    expect(isTurnActive(status)).toBe(expected);
  });
});

describe("gatedTurnEntry: sends are dropped, never raced", () => {
  it("passes the call through while no turn is active", () => {
    const entry = vi.fn();
    gatedTurnEntry("ready", entry)("ハルヒ");
    expect(entry).toHaveBeenCalledExactlyOnceWith("ハルヒ");
  });

  it("passes the call through after a failed turn settles", () => {
    const entry = vi.fn();
    gatedTurnEntry("error", entry)("ハルヒ");
    expect(entry).toHaveBeenCalledTimes(1);
  });

  it("drops the call while a turn is streaming", () => {
    const entry = vi.fn();
    gatedTurnEntry("streaming", entry)("ハルヒ");
    expect(entry).not.toHaveBeenCalled();
  });

  it("drops the call while a turn is still being admitted", () => {
    const entry = vi.fn();
    gatedTurnEntry("submitted", entry)("ハルヒ");
    expect(entry).not.toHaveBeenCalled();
  });
});
