/**
 * Spot coordinate validity tests (X15 #285, coordinate-rejection AC support).
 *
 * Pins the publishable-coordinates specification the quality gate applies:
 * WGS-84 bounds, null island exclusion, and numeric sanity at the boundary.
 */
import { describe, expect, it } from "vitest";
import {
  isNullIsland,
  isPublishableSpotCoordinates,
} from "../src/publish/spot-coordinates";

describe("isPublishableSpotCoordinates", () => {
  it("accepts an ordinary on-land coordinate", () => {
    expect(isPublishableSpotCoordinates({ latitude: 35.01, longitude: 139.01 })).toBe(true);
  });

  it("accepts the hemisphere boundaries as the inclusive valid range", () => {
    const corners = [
      { latitude: 90, longitude: 180 },
      { latitude: 90, longitude: -180 },
      { latitude: -90, longitude: 180 },
      { latitude: -90, longitude: -180 },
    ];
    expect(corners.filter((corner) => !isPublishableSpotCoordinates(corner))).toEqual([]);
  });

  it("accepts the equator and the prime meridian away from the origin", () => {
    expect(isPublishableSpotCoordinates({ latitude: 0, longitude: 139 })).toBe(true);
    expect(isPublishableSpotCoordinates({ latitude: 35, longitude: 0 })).toBe(true);
  });

  it("rejects a latitude outside ±90", () => {
    expect(isPublishableSpotCoordinates({ latitude: 90.000001, longitude: 139 })).toBe(false);
    expect(isPublishableSpotCoordinates({ latitude: -90.000001, longitude: 139 })).toBe(false);
  });

  it("rejects a longitude outside ±180", () => {
    expect(isPublishableSpotCoordinates({ latitude: 35, longitude: 180.000001 })).toBe(false);
    expect(isPublishableSpotCoordinates({ latitude: 35, longitude: -180.000001 })).toBe(false);
  });

  it("rejects null island (0,0) — the un-geocoded sentinel", () => {
    expect(isPublishableSpotCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it("rejects non-numeric coordinates", () => {
    expect(isPublishableSpotCoordinates({ latitude: Number.NaN, longitude: 139 })).toBe(false);
    expect(isPublishableSpotCoordinates({ latitude: 35, longitude: Number.NaN })).toBe(false);
    expect(isPublishableSpotCoordinates({ latitude: Number.POSITIVE_INFINITY, longitude: 139 })).toBe(false);
  });
});

describe("isNullIsland", () => {
  it("holds exactly at latitude 0 and longitude 0", () => {
    expect(isNullIsland({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isNullIsland({ latitude: 0, longitude: 0.000001 })).toBe(false);
    expect(isNullIsland({ latitude: 0.000001, longitude: 0 })).toBe(false);
  });
});
