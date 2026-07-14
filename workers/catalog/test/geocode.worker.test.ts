import { describe, expect, it, vi } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { geocode } from "../src/api/geocode";
import {
  collapseGeocodeHits,
  FUZZY_RESULT_LIMIT,
  FUZZY_SIMILARITY_THRESHOLD,
  type GeocodeHit,
} from "../src/lib/geocode";
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

interface FakeDb extends CatalogDb {
  executeSpy: ReturnType<typeof vi.fn>;
}

function fakeDb(...responses: GeocodeHit[][]): FakeDb {
  const pending = [...responses];
  const executeSpy = vi.fn((_query: unknown) =>
    Promise.resolve({ rows: pending.shift() ?? [] }),
  );
  return {
    execute: executeSpy,
    executeSpy,
  } as unknown as FakeDb;
}

function hit(overrides: Partial<GeocodeHit>): GeocodeHit {
  return { ...NISHINOMIYA, ...overrides };
}

function sqlText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  if ("value" in value && Array.isArray(value.value)) return value.value.join("");
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.map(sqlText).join("");
}

async function fuzzySql(): Promise<string> {
  const db = fakeDb([], []);
  await geocode(db, { query: "西宮北口", limit: 5 });
  return sqlText(db.executeSpy.mock.calls[1]?.[0]);
}

describe("catalog geocode lookup", () => {
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

});

describe("catalog geocode fuzzy lookup", () => {
  it("B2 fuzzy-matches 西宮北口 after an exact miss", async () => {
    const fuzzy = hit({ id: "mlit:nishinomiya-kitaguchi", name: "西宮北口駅", exact: false });
    const db = fakeDb([], [fuzzy]);

    const result = await geocode(db, { query: "西宮北口", limit: 5 });

    expect(result.candidates[0]).toMatchObject({ id: fuzzy.id, name: "西宮北口駅" });
    expect(db.executeSpy.mock.calls).toHaveLength(2);
  });

  it("B2 returns empty when fuzzy similarity is below threshold", async () => {
    const db = fakeDb([], []);

    await expect(geocode(db, { query: "ﾒﾁｬｸﾁｬ名前", limit: 5 })).resolves.toEqual({ candidates: [] });
    expect(db.executeSpy.mock.calls).toHaveLength(2);
    expect(FUZZY_SIMILARITY_THRESHOLD).toBe(0.4);
    expect(FUZZY_RESULT_LIMIT).toBe(10);
  });

  it("B2 exact hit strictly short-circuits the fuzzy query", async () => {
    const db = fakeDb([NISHINOMIYA]);

    await geocode(db, { query: "西宮", limit: 5 });

    expect(db.executeSpy.mock.calls).toHaveLength(1);
  });

  it("B2 deduplicates aliases per location before applying the fuzzy limit", async () => {
    expect(await fuzzySql()).toContain("SELECT DISTINCT ON (l.id)");
  });

  it("B2 applies deterministic inner and outer fuzzy tie-breaks", async () => {
    const query = await fuzzySql();
    expect(query).toContain("ORDER BY l.id, similarity(a.alias_normalized,");
    expect(query).toContain("DESC, a.priority DESC");
    expect(query).toContain("ORDER BY sim DESC, priority DESC, id ASC");
  });

  it("B2 uses the trigram match operator so the GIN index can serve fuzzy lookup", async () => {
    expect(await fuzzySql()).toContain("WHERE a.alias_normalized %");
  });
});

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
