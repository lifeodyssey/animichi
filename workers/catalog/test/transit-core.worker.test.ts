import { describe, expect, it } from "vitest";
import { MinHeap, isTransitCandidate, shortestPath, buildTransitIndex, WALK_DETOUR_COEFFICIENT, WALKING_SPEED_M_PER_MIN } from "../src/lib/transit";
import { tokyoSample } from "./fixtures/transit/tokyo-sample";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected test value");
  return value;
};

describe("isTransitCandidate", () => {
  it("rejects an 800 metre trip", () => {
    expect(isTransitCandidate(800)).toBe(false);
  });

  it("uses a strict straight-line boundary", () => {
    expect(isTransitCandidate(1500)).toBe(false);
    expect(isTransitCandidate(1499)).toBe(false);
    expect(isTransitCandidate(1501)).toBe(true);
  });

  it("has distance as the binding threshold under current constants", () => {
    const walkingMinutes = 1501 * WALK_DETOUR_COEFFICIENT / WALKING_SPEED_M_PER_MIN;
    expect(walkingMinutes).toBeLessThan(25);
    expect(isTransitCandidate(1501)).toBe(true);
  });

  it("accepts 1539 metres under both threshold clauses", () => {
    const walkingMinutes = 1539 * WALK_DETOUR_COEFFICIENT / WALKING_SPEED_M_PER_MIN;
    expect(walkingMinutes).toBeGreaterThan(25);
    expect(isTransitCandidate(1539)).toBe(true);
  });
});

describe("MinHeap", () => {
  it("pops values by ascending priority", () => {
    const heap = new MinHeap<string>();
    heap.push("three", 3);
    heap.push("one", 1);
    heap.push("two", 2);
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual(["one", "two", "three", undefined]);
  });

  it("breaks equal-priority ties by the supplied key", () => {
    const heap = new MinHeap<string>();
    heap.push("later", 1, "z");
    heap.push("earlier", 1, "a");
    expect([heap.pop(), heap.pop()]).toEqual(["earlier", "later"]);
  });
});

describe("shortestPath", () => {
  it("returns an ordered direct rail path", () => {
    const path = required(shortestPath(buildTransitIndex(tokyoSample), "shinjuku-c", "kichijoji-c"));
    expect(path.station_ids[0]).toBe("shinjuku-c");
    expect(path.station_ids.at(-1)).toBe("kichijoji-c");
    expect(path.transfers).toBe(0);
  });

  it("returns null for unknown stations", () => {
    expect(shortestPath(buildTransitIndex(tokyoSample), "missing", "kichijoji-c")).toBeNull();
  });
});
