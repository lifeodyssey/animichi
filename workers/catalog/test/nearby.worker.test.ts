import { describe, expect, it } from "vitest";
import type { CatalogDb, NeonSql } from "../src/db/client";
import { nearby } from "../src/api/nearby";

/**
 * Unit tests for the `nearby` read API handler (card W2-4).
 *
 * No Docker: `findPointsWithinRadius` (the ST_DWithin primitive) is already
 * integration-tested against real PostGIS in geo-query.spike.test.ts. Here we
 * fake the two reads `nearby()` performs:
 *   - geo read: via `neonSql` template tag (findPointsWithinRadius)
 *   - detail read: via `db.execute(sql)` (loadDetails)
 * Named *.worker.test.ts so the existing vitest-pool-workers config picks it up;
 * the logic is runtime-agnostic.
 *
 * Fixture: two points near Washinomiya, returned nearest-first by the geo read.
 */

interface GeoRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

interface DetailRow {
  id: string;
  bangumi_id: string | null;
  name_cn: string | null;
  image: string | null;
  episode: number | null;
  time_seconds: number | null;
  origin: string | null;
  city: string | null;
}

const GEO: GeoRow[] = [
  { id: "washinomiya", name: "鷲宮神社", latitude: 36.1019, longitude: 139.6586, distance_m: 5 },
  { id: "satte", name: "幸手権現堂", latitude: 36.0833, longitude: 139.725, distance_m: 4200 },
];

const DETAILS: DetailRow[] = [
  { id: "washinomiya", bangumi_id: "lucky-star", name_cn: "鹫宫神社", image: "https://img/w.jpg", episode: 1, time_seconds: 12, origin: "anitabi", city: "Kuki" },
  { id: "satte", bangumi_id: "lucky-star", name_cn: null, image: null, episode: null, time_seconds: null, origin: null, city: null },
];

/** Minimal CatalogDb double: handles the detail-load IN read via db.execute(sql). */
function fakeDb(details: DetailRow[]): CatalogDb {
  return {
    execute: (_query: unknown) => Promise.resolve({ rows: details }),
  } as unknown as CatalogDb;
}

/** Minimal NeonSql double: returns geo rows for the ST_DWithin read. */
function fakeNeonSql(geo: GeoRow[]): NeonSql {
  return Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve(geo),
    { transaction: undefined },
  ) as unknown as NeonSql;
}

const run = (geo: GeoRow[], details: DetailRow[]) =>
  nearby(fakeDb(details), fakeNeonSql(geo), { lat: 36.1019, lng: 139.6586, radius_m: 10_000 });

describe("nearby (api/nearby.ts)", () => {
  it("returns rows nearest-first with distance_m carried from the geo read", async () => {
    const { rows } = await run(GEO, DETAILS);
    expect(rows.map((r) => r.id)).toEqual(["washinomiya", "satte"]);
    expect(rows.map((r) => r.distance_m)).toEqual([5, 4200]);
  });

  it("merges detail columns onto the contract PilgrimagePoint shape", async () => {
    const { rows } = await run(GEO, DETAILS);
    expect(rows[0]).toMatchObject({
      id: "washinomiya",
      name: "鷲宮神社",
      name_cn: "鹫宫神社",
      bangumi_id: "lucky-star",
      episode: 1,
      time_seconds: 12,
      screenshot_url: "https://img/w.jpg",
      latitude: 36.1019,
      longitude: 139.6586,
      origin: "anitabi",
      city: "Kuki",
    });
  });

  it("defaults required fields when a detail row has nulls", async () => {
    const { rows } = await run(GEO, DETAILS);
    expect(rows[1]).toMatchObject({ bangumi_id: "lucky-star", screenshot_url: "" });
    expect(rows[1]?.name_cn).toBeUndefined();
    expect(rows[1]?.episode).toBeUndefined();
  });

  it("returns an empty rows array when no point is within the radius", async () => {
    const { rows } = await run([], []);
    expect(rows).toEqual([]);
  });
});
