/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { median, p75, percentile, sampleStatus } from "../../../src/features/telemetry/lib/vitals-stats";

describe("vitals-stats percentiles (issue #1010 AC5)", () => {
  it("returns the nearest-rank 75th percentile", () => {
    // n=4 -> rank ceil(.75*4)=3 -> the 3rd smallest (300).
    expect(p75([100, 200, 300, 400])).toBe(300);
    // n=5 -> rank ceil(.75*5)=4 -> the 4th smallest (400).
    expect(p75([100, 200, 300, 400, 500])).toBe(400);
  });

  it("returns null for an empty sample set (never fabricates a p75)", () => {
    expect(p75([])).toBeNull();
    expect(percentile([], 75)).toBeNull();
  });

  it("handles a single sample as its own p75", () => {
    expect(p75([123])).toBe(123);
  });

  it("median (50th) matches the nearest-rank ordering", () => {
    // odd count -> true middle
    expect(median([5, 1, 3])).toBe(3);
    // even count -> nearest-rank upper-middle (rank ceil(.5*4)=2)
    expect(median([4, 1, 2, 3])).toBe(2);
  });

  it("does not mutate the caller's input ordering", () => {
    const input = [4, 1, 2, 3];
    const before = [...input];
    p75(input);
    expect(input).toEqual(before);
  });

  it("classifies sample sets as sufficient vs insufficient against the floor", () => {
    expect(sampleStatus(10, 10)).toBe("sufficient");
    expect(sampleStatus(9, 10)).toBe("insufficient");
    expect(sampleStatus(0, 5)).toBe("insufficient");
  });
});
