import { describe, expect, it, vi } from "vitest";
import {
  animeOverview,
  AnimeOverviewNotFoundError,
  type OverviewDb,
} from "../src/api/anime-overview";

/**
 * Unit tests for the public `animeOverview` read handler
 * (catalog/src/api/anime-overview.ts). No Docker / no live Postgres: the handler
 * only touches `db.execute(sql`...`)` returning `{ rows }`, so a typed fake is
 * injected. Asserts the contract AnimeOverview shape: bubble aggregation
 * (region + count), 名場面 ranking (by shot count), and per-region sample routes.
 * Named *.worker.test.ts so vitest-pool-workers picks it up.
 */

interface FixtureRow {
  id: string;
  name: string;
  image: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
}

function row(id: string, lat: number, lng: number, city: string | null, image: string | null = null): FixtureRow {
  return { id, name: id.toUpperCase(), image, latitude: lat, longitude: lng, city };
}

/** Fake db whose execute() returns the fixture rows once. */
function fakeDb(rows: FixtureRow[]): OverviewDb {
  return { execute: () => Promise.resolve({ rows }) };
}

function knownEmptyDb(): OverviewDb {
  const execute = vi.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "999" }] });
  return { execute };
}

// Two Kamakura points co-located (< 50m → one cluster of 2 shots) + one lone Hakone point.
const KAMAKURA_A = row("k1", 35.30660, 139.48890, "Kamakura", "https://img/k1.jpg");
const KAMAKURA_B = row("k2", 35.30661, 139.48891, "Kamakura");
const HAKONE = row("h1", 35.23230, 139.10690, "Hakone", "https://img/h1.jpg");
const SPREAD: FixtureRow[] = [KAMAKURA_A, KAMAKURA_B, HAKONE];

describe("animeOverview (api/anime-overview.ts)", () => {
  it("aggregates region bubbles with counts and centroids", async () => {
    const result = await animeOverview(fakeDb(SPREAD), { bangumi_id: "100" });
    expect(result.bangumi_id).toBe("100");
    expect(result.points_length).toBe(3);
    expect(result.circles.map((c) => [c.region, c.count])).toEqual([
      ["Kamakura", 2],
      ["Hakone", 1],
    ]);
    const [kamakura] = result.circles;
    expect(kamakura?.lat).toBeCloseTo(35.306605, 6);
    expect(kamakura?.lng).toBeCloseTo(139.488905, 6);
  });

  it("ranks 名場面 by shot count (co-located points merge into one scene)", async () => {
    const result = await animeOverview(fakeDb(SPREAD), { bangumi_id: "100" });
    expect(result.scenes.map((s) => [s.id, s.shot_count])).toEqual([
      ["k1", 2],
      ["h1", 1],
    ]);
    const [top] = result.scenes;
    expect(top).toMatchObject({ name: "K1", screenshot_url: "https://img/k1.jpg", city: "Kamakura" });
  });

  it("suggests per-region sample routes ordered by spot count", async () => {
    const result = await animeOverview(fakeDb(SPREAD), { bangumi_id: "100" });
    expect(result.sample_routes).toEqual([
      { region: "Kamakura", point_ids: ["k1", "k2"] },
      { region: "Hakone", point_ids: ["h1"] },
    ]);
  });

});

describe("animeOverview empty and missing work behavior", () => {
  it("returns an empty-but-valid overview when a known work has no points", async () => {
    const result = await animeOverview(knownEmptyDb(), { bangumi_id: "999" });
    expect(result).toEqual({
      bangumi_id: "999",
      points_length: 0,
      circles: [],
      scenes: [],
      sample_routes: [],
    });
  });

  it("throws a typed domain miss when the anime does not exist", async () => {
    await expect(animeOverview(fakeDb([]), { bangumi_id: "404" }))
      .rejects.toBeInstanceOf(AnimeOverviewNotFoundError);
  });

});

describe("animeOverview scene edge cases", () => {
  it("returns empty circles (no region clustering) for spots lacking a city, without erroring", async () => {
    const noCity: FixtureRow[] = [row("n1", 35.0, 139.0, null), row("n2", 36.0, 140.0, "")];
    const result = await animeOverview(fakeDb(noCity), { bangumi_id: "200" });
    expect(result.circles).toEqual([]);
    expect(result.sample_routes).toEqual([]);
    expect(result.scenes).toHaveLength(2);
    expect(result.points_length).toBe(2);
  });

  it("omits city on a scene whose representative point has no city", async () => {
    const result = await animeOverview(fakeDb([row("x1", 34.0, 138.0, null)]), { bangumi_id: "300" });
    expect(result.scenes[0]?.city).toBeUndefined();
    expect(result.scenes[0]?.screenshot_url).toBeNull();
  });

  it("uses an image-bearing cluster member as the representative", async () => {
    const rows = [
      row("a-no-image", 35.0, 139.0, "Tokyo"),
      row("b-image", 35.00001, 139.00001, "Tokyo", "https://img/scene.jpg"),
    ];
    const result = await animeOverview(fakeDb(rows), { bangumi_id: "301" });
    expect(result.scenes[0]).toMatchObject({
      id: "b-image", screenshot_url: "https://img/scene.jpg", shot_count: 2,
    });
  });

  it("caps the quadratic clustering input while preserving the total count", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      row(`p-${String(index).padStart(3, "0")}`, 35.0, 139.0, "Tokyo"));
    const result = await animeOverview(fakeDb(rows), { bangumi_id: "302" });
    expect(result.points_length).toBe(501);
    expect(result.scenes[0]?.shot_count).toBe(500);
  });
});

describe("animeOverview output caps", () => {
  it("caps scenes at 20, sample routes at 3 regions, and point ids at 12 per route", async () => {
    const result = await animeOverview(fakeDb(cappedFixture()), { bangumi_id: "400" });
    expect(result.scenes).toHaveLength(20);
    expect(result.sample_routes.map((r) => r.region)).toEqual(["A", "B", "C"]);
    expect(result.sample_routes[0]?.point_ids).toHaveLength(12);
  });
});

/** 21 far-apart points across 4 regions (A:15, B:3, C:2, D:1) — exercises the
 * scene (20), region (3), and per-route point (12) caps in one fixture. */
function cappedFixture(): FixtureRow[] {
  const plan: [string, number][] = [["A", 15], ["B", 3], ["C", 2], ["D", 1]];
  let seq = 0;
  return plan.flatMap(([region, n]) =>
    Array.from({ length: n }, () => {
      const id = `${region}-${String(seq).padStart(2, "0")}`;
      return row(id, 30 + seq++ * 0.01, 138.0, region);
    }),
  );
}
