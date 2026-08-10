import { describe, expect, it } from "vitest";
import { collapseGeocodeHits, isValidGeocodeHit } from "../src/domain/geocode/collapse";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";
import { hit } from "./geocode-doubles";

describe("catalog geocode clustering", () => {
  it("A3 single-link clustering collapses a bridge chain", () => {
    const chain = [
      hit({ id: "a", longitude: 135.00 }),
      hit({ id: "b", longitude: 135.10 }),
      hit({ id: "c", longitude: 135.20 }),
    ];
    expect(collapseGeocodeHits(chain, 5)).toHaveLength(1);
  });

  it("A3 representative and output are deterministic after shuffling", () => {
    const city = hit({ id: "city", kind: "city", priority: 100 });
    const station = hit({ id: "station-z", kind: "station", priority: 5 });
    const preferredStation = hit({ id: "station-a", kind: "station", priority: 5 });
    const expected = collapseGeocodeHits([city, station, preferredStation], 5);
    expect(collapseGeocodeHits([preferredStation, city, station], 5)).toEqual(expected);
    expect(expected[0]).toMatchObject({ id: "station-a", effective_radius_m: 10_000 });
  });

  it("A3 orders multiple clusters by exactness, priority, and id", () => {
    const clusters = [
      hit({ id: "fuzzy", longitude: 135, priority: 999, exact: false }),
      hit({ id: "exact-low", longitude: 136, priority: 1 }),
      hit({ id: "exact-high", longitude: 137, priority: 100 }),
    ];
    expect(collapseGeocodeHits(clusters, 5).map((candidate) => candidate.id)).toEqual([
      "exact-high",
      "exact-low",
      "fuzzy",
    ]);
  });

  it("A3 truncates ordered clusters at the requested limit", () => {
    const clusters = [
      hit({ id: "third", longitude: 135, priority: 1 }),
      hit({ id: "first", longitude: 136, priority: 3 }),
      hit({ id: "second", longitude: 137, priority: 2 }),
    ];
    expect(collapseGeocodeHits(clusters, 2).map((candidate) => candidate.id)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("catalog geocode mixed-kind collapse", () => {
  it("B2' 東京 city and station collapse to the station with a 10km radius", () => {
    const tokyo = hit({
      id: "seed:tokyo",
      name: "東京",
      kind: "city",
      latitude: 35.6762,
      longitude: 139.6503,
    });
    const tokyoStation = hit({
      id: "seed:tokyo-station",
      name: "東京駅",
      latitude: 35.6812,
      longitude: 139.7671,
    });

    expect(collapseGeocodeHits([tokyo, tokyoStation], 5)).toMatchObject([
      { id: "seed:tokyo-station", kind: "station", effective_radius_m: 10_000 },
    ]);
  });
});

describe("catalog geocode seed fixture", () => {
  it("A9 seed fixture resolves all 30 aliases to the 20 audited locations", () => {
    expect(Object.keys(SEED_LOCATIONS)).toHaveLength(20);
    expect(SEED_ALIASES).toHaveLength(30);
    for (const [alias, locationId] of SEED_ALIASES) {
      const location = SEED_LOCATIONS[locationId];
      expect(location, alias).toBeDefined();
      if (!location) throw new Error(`missing seed location for ${alias}`);
      expect(collapseGeocodeHits([{ ...location, priority: 100, exact: true }], 5)[0]?.id).toBe(locationId);
    }
  });
});

describe("catalog geocode row validity", () => {
  it("accepts a hit with finite coordinates", () => {
    expect(isValidGeocodeHit(hit({}))).toBe(true);
  });

  it("rejects a NaN latitude", () => {
    expect(isValidGeocodeHit(hit({ latitude: Number.NaN }))).toBe(false);
  });

  it("rejects a NaN longitude", () => {
    expect(isValidGeocodeHit(hit({ longitude: Number.NaN }))).toBe(false);
  });

  it("rejects an infinite coordinate", () => {
    expect(isValidGeocodeHit(hit({ latitude: Number.POSITIVE_INFINITY }))).toBe(false);
  });
});
