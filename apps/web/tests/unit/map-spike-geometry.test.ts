import { describe, expect, it } from "vitest";
import {
  illustrationPoints,
  polylinePoints,
  projectWebMercator,
} from "../../src/features/map-spike/geometry";
import { SPOTS, STATIC_BOUNDS, STATIC_SIZE } from "../../src/features/map-spike/spots";

describe("projectWebMercator", () => {
  it("maps the west/north bounds corner to the top-left origin", () => {
    const point = projectWebMercator([STATIC_BOUNDS.west, STATIC_BOUNDS.north], STATIC_BOUNDS, STATIC_SIZE);
    expect(point.x).toBeCloseTo(0, 5);
    expect(point.y).toBeCloseTo(0, 5);
  });

  it("maps the east/south bounds corner to the bottom-right extent", () => {
    const point = projectWebMercator([STATIC_BOUNDS.east, STATIC_BOUNDS.south], STATIC_BOUNDS, STATIC_SIZE);
    expect(point.x).toBeCloseTo(STATIC_SIZE.width, 5);
    expect(point.y).toBeCloseTo(STATIC_SIZE.height, 5);
  });

  it("keeps interior longitudes inside the canvas width", () => {
    const point = projectWebMercator([135.811, 34.8937], STATIC_BOUNDS, STATIC_SIZE);
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(STATIC_SIZE.width);
  });
});

describe("illustrationPoints", () => {
  it("projects one point per pilgrimage spot", () => {
    expect(illustrationPoints()).toHaveLength(SPOTS.length);
  });
});

describe("polylinePoints", () => {
  it("joins projected points as space-separated fixed coordinates", () => {
    const value = polylinePoints([
      { x: 1.234, y: 5.678 },
      { x: 9, y: 10 },
    ]);
    expect(value).toBe("1.2,5.7 9.0,10.0");
  });
});
