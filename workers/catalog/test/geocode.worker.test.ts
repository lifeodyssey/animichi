import { describe, expect, it, vi } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { geocode } from "../src/api/geocode";
import { collapseGeocodeHits, type GeocodeHit } from "../src/lib/geocode";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";

const NISHINOMIYA: GeocodeHit = {
  id: "seed:nishinomiya-station",
  name: "西宮駅",
  kind: "station",
  latitude: 34.7386,
  longitude: 135.3485,
  source: "manual",
  pref: "兵庫県",
  priority: 100,
  exact: true,
};

function fakeDb(rows: GeocodeHit[]): CatalogDb {
  return {
    execute: (_query: unknown) => Promise.resolve({ rows }),
  } as unknown as CatalogDb;
}

function hit(overrides: Partial<GeocodeHit>): GeocodeHit {
  return { ...NISHINOMIYA, ...overrides };
}

describe("catalog geocode", () => {
  it.each(["西宮", "西宫", "nishinomiya"])("A1 exact lookup resolves %s", async (query) => {
    const result = await geocode(fakeDb([NISHINOMIYA]), { query, limit: 5 });
    expect(result.candidates).toEqual([{
      id: NISHINOMIYA.id,
      label: "西宮駅(兵庫県)",
      name: "西宮駅",
      lat: 34.7386,
      lng: 135.3485,
      kind: "station",
      source: "manual",
      effective_radius_m: 5000,
    }]);
  });

  it("A1 mixed city and station cluster carries a 10km effective radius over the wire", async () => {
    const city = hit({ id: "city", name: "西宮市", kind: "city", priority: 100 });
    const result = await geocode(fakeDb([NISHINOMIYA, city]), { query: "西宮", limit: 5 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: NISHINOMIYA.id,
      kind: "station",
      effective_radius_m: 10_000,
    });
  });

  it("A1 東京 exact lookup returns one collapsed candidate", async () => {
    const tokyo = hit({ id: "seed:tokyo", name: "東京", kind: "city", latitude: 35.6762, longitude: 139.6503, pref: "東京都" });
    const result = await geocode(fakeDb([tokyo]), { query: "東京", limit: 5 });
    expect(result.candidates).toHaveLength(1);
  });

  it("A2 miss returns empty without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(geocode(fakeDb([]), { query: "不存在", limit: 5 })).resolves.toEqual({ candidates: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

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
