import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { spots, SpotNotFoundError } from "../src/api/spots";

/**
 * Unit tests for the `spots` read handler (catalog/src/api/spots.ts).
 *
 * No Docker / no live Postgres: the only DB surface `spots` touches is
 * `db.execute(sql`...`)` returning `{ rows }` (the geo-query.ts pattern), so a
 * typed fake `execute` returning fixture rows is injected via `fakeDb()` and
 * cast to CatalogDb at the boundary. Asserts the contract shape
 * { point, distance_m? } where `point` is a SINGLE PilgrimagePoint.
 * Named *.worker.test.ts so the vitest-pool-workers config picks it up.
 */

interface FixtureRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
}

const KAMAKURA: FixtureRow = {
  id: "spot-1",
  name: "鎌倉高校前駅",
  name_cn: "镰仓高校前站",
  bangumi_id: "100",
  episode: 1,
  time_seconds: 42,
  image: "https://image.anitabi.cn/spot-1.jpg",
  latitude: 35.3066,
  longitude: 139.4889,
};

/** Build a fake CatalogDb whose execute() returns the given rows once. */
function fakeDb(rows: FixtureRow[]): CatalogDb {
  const fake = { execute: async () => ({ rows }) };
  return fake as unknown as CatalogDb;
}

describe("spots (api/spots.ts)", () => {
  it("maps a known bangumi_id row to the contract PilgrimagePoint shape", async () => {
    const { point } = await spots(fakeDb([KAMAKURA]), { bangumi_id: "100" });
    expect(point).toEqual({
      id: "spot-1",
      name: "鎌倉高校前駅",
      name_cn: "镰仓高校前站",
      bangumi_id: "100",
      episode: 1,
      time_seconds: 42,
      screenshot_url: "https://image.anitabi.cn/spot-1.jpg",
      latitude: 35.3066,
      longitude: 139.4889,
    });
  });

  it("omits distance_m when no origin is given", async () => {
    const result = await spots(fakeDb([KAMAKURA]), { bangumi_id: "100" });
    expect(result.distance_m).toBeUndefined();
  });

  it("computes distance_m via haversine for a lat/lng origin", async () => {
    const origin = { lat: 35.681236, lng: 139.767125 }; // Tokyo Station
    const { distance_m } = await spots(fakeDb([KAMAKURA]), {
      bangumi_id: "100",
      origin,
    });
    // haversine(35.681236,139.767125, 35.3066,139.4889) ~= 48_680.6 m
    expect(distance_m).toBeCloseTo(48680.64593671334, 4);
  });

  it("omits distance_m for a named-place (string) origin", async () => {
    const result = await spots(fakeDb([KAMAKURA]), {
      bangumi_id: "100",
      origin: "東京駅",
    });
    expect(result.distance_m).toBeUndefined();
  });

  it("coerces null optional columns to absent / empty per the contract", async () => {
    const bare: FixtureRow = {
      id: "spot-2",
      name: "鷲宮神社",
      name_cn: null,
      bangumi_id: "200",
      episode: null,
      time_seconds: null,
      image: null,
      latitude: 36.1019,
      longitude: 139.6586,
    };
    const { point } = await spots(fakeDb([bare]), { bangumi_id: "200" });
    expect(point.name_cn).toBeUndefined();
    expect(point.episode).toBeUndefined();
    expect(point.time_seconds).toBeUndefined();
    expect(point.screenshot_url).toBe("");
  });

  it("throws SpotNotFoundError for an unknown bangumi_id (no points)", async () => {
    await expect(spots(fakeDb([]), { bangumi_id: "999" })).rejects.toBeInstanceOf(
      SpotNotFoundError,
    );
  });
});
