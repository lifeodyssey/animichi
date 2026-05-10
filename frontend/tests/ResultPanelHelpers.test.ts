/**
 * ResultPanelHelpers — pointAreaI18n + buildAreasI18n coverage.
 *
 * Tests verify:
 * - pointAreaI18n reads city field from point
 * - buildAreasI18n with mixed points (some with city, some without)
 * - buildEpRanges filters ep=0 (movies)
 */
import { describe, it, expect } from "vitest";
import {
  buildAreasI18n,
  pointAreaI18n,
  buildEpRanges,
  epRangeLabel,
} from "@/components/layout/ResultPanelHelpers";
import type { PilgrimagePoint } from "@/lib/types";

function makePoint(
  lat: number,
  lng: number,
  city?: string,
  episode?: number,
): PilgrimagePoint {
  return {
    id: `p-${lat}-${lng}`,
    name: "Test",
    name_cn: null,
    episode: episode ?? null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: "1",
    latitude: lat,
    longitude: lng,
    city: city ?? null,
  };
}

describe("pointAreaI18n", () => {
  it("returns city when point has city field", () => {
    const point = makePoint(34.888, 135.802, "Uji");
    expect(pointAreaI18n(point, "その他")).toBe("Uji");
  });

  it("returns otherLabel when city is null", () => {
    const point = makePoint(35.68, 139.76);
    expect(pointAreaI18n(point, "その他")).toBe("その他");
  });

  it("returns otherLabel when city is empty string", () => {
    const point = makePoint(35.68, 139.76, "");
    expect(pointAreaI18n(point, "Other")).toBe("Other");
  });
});

describe("buildAreasI18n", () => {
  it("returns sorted unique area labels from city field", () => {
    const points = [
      makePoint(34.888, 135.802, "Uji"),
      makePoint(34.985, 135.758, "Kyoto"),
      makePoint(34.889, 135.803, "Uji"), // deduplicated
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toEqual(["Kyoto", "Uji"]);
  });

  it("includes otherLabel for points without city", () => {
    const points = [
      makePoint(34.888, 135.802, "Uji"),
      makePoint(35.68, 139.76), // no city
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toContain("Uji");
    expect(areas).toContain("その他");
  });

  it("returns only otherLabel when no points have city", () => {
    const points = [
      makePoint(35.68, 139.76),
      makePoint(43.06, 141.35),
    ];
    const areas = buildAreasI18n(points, "Other");
    expect(areas).toEqual(["Other"]);
  });

  it("returns empty for no points", () => {
    const areas = buildAreasI18n([], "その他");
    expect(areas).toEqual([]);
  });

  it("handles mixed points with multiple cities and unknown", () => {
    const points = [
      makePoint(34.888, 135.802, "Uji"),
      makePoint(34.686, 135.520, "Osaka"),
      makePoint(35.68, 139.76), // no city → その他
      makePoint(34.690, 135.195, "Kobe"),
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toEqual(["Kobe", "Osaka", "Uji", "その他"]);
  });
});

describe("buildEpRanges", () => {
  it("filters out ep=0 (movies)", () => {
    const points = [
      makePoint(0, 0, undefined, 0),
      makePoint(0, 0, undefined, 0),
    ];
    expect(buildEpRanges(points)).toEqual([]);
  });

  it("includes ep > 0 (TV series)", () => {
    const points = [
      makePoint(0, 0, undefined, 1),
      makePoint(0, 0, undefined, 5),
    ];
    const ranges = buildEpRanges(points);
    expect(ranges).toContain(epRangeLabel(1));
    expect(ranges).toContain(epRangeLabel(5));
  });
});
