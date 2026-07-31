import type { AnimeOverviewCircle } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import {
  type BubblePlacement,
  MAX_BUBBLE_RADIUS,
  MIN_BUBBLE_RADIUS,
  bubblePlacements,
  bubbleRadius,
  circlesMaxCount,
  hasBubbles,
} from "../../../src/features/bubble-map/bubbleGeometry";

function circle(overrides: Partial<AnimeOverviewCircle>): AnimeOverviewCircle {
  return { region: "Tokyo", count: 1, lat: 35.68, lng: 139.76, ...overrides };
}

function placeOf(circles: readonly AnimeOverviewCircle[], region: string): BubblePlacement {
  const found = bubblePlacements(circles).find((placement) => placement.region === region);
  if (!found) throw new Error(`no placement for ${region}`);
  return found;
}

describe("bubbleRadius (area proportional to spot count)", () => {
  it("maps the busiest region to the maximum radius", () => {
    expect(bubbleRadius(8, 8)).toBe(MAX_BUBBLE_RADIUS);
  });

  it("floors a zero-count region at the minimum radius", () => {
    expect(bubbleRadius(0, 8)).toBe(MIN_BUBBLE_RADIUS);
  });

  it("grows monotonically with the spot count", () => {
    expect(bubbleRadius(4, 8)).toBeGreaterThan(bubbleRadius(1, 8));
  });

  it("scales by area so radius tracks the square root of count", () => {
    const quarter = bubbleRadius(2, 8);
    const span = MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS;
    expect(quarter - MIN_BUBBLE_RADIUS).toBeCloseTo(span * 0.5, 5);
  });

  it("falls back to the minimum radius when no region has spots", () => {
    expect(bubbleRadius(0, 0)).toBe(MIN_BUBBLE_RADIUS);
  });
});

describe("circlesMaxCount", () => {
  it("returns the largest spot count across regions", () => {
    expect(circlesMaxCount([circle({ count: 2 }), circle({ count: 5 })])).toBe(5);
  });

  it("returns zero for no regions", () => {
    expect(circlesMaxCount([])).toBe(0);
  });
});

describe("hasBubbles", () => {
  it("is false with no circles", () => {
    expect(hasBubbles([])).toBe(false);
  });

  it("is true for a single region", () => {
    expect(hasBubbles([circle({})])).toBe(true);
  });
});

describe("bubblePlacements", () => {
  it("centers a single region so it never renders off-canvas", () => {
    const only = placeOf([circle({ count: 3 })], "Tokyo");
    expect(only.leftPct).toBe(50);
    expect(only.topPct).toBe(50);
  });

  it("places a northern region above a southern one", () => {
    const circles = [
      circle({ region: "Sapporo", lat: 43.06, lng: 141.35, count: 1 }),
      circle({ region: "Naha", lat: 26.21, lng: 127.68, count: 1 }),
    ];
    expect(placeOf(circles, "Sapporo").topPct).toBeLessThan(placeOf(circles, "Naha").topPct);
  });

  it("places an eastern region right of a western one", () => {
    const circles = [
      circle({ region: "Fukuoka", lat: 33.59, lng: 130.4, count: 1 }),
      circle({ region: "Tokyo", lat: 35.68, lng: 139.76, count: 1 }),
    ];
    expect(placeOf(circles, "Tokyo").leftPct).toBeGreaterThan(placeOf(circles, "Fukuoka").leftPct);
  });

  it("carries the region name, count, and count-scaled radius", () => {
    const circles = [
      circle({ region: "Big", count: 8, lat: 35, lng: 139 }),
      circle({ region: "Small", count: 1, lat: 34, lng: 138 }),
    ];
    const big = placeOf(circles, "Big");
    expect(big.count).toBe(8);
    expect(big.radius).toBeGreaterThan(placeOf(circles, "Small").radius);
  });
});
