import { describe, expect, it } from "vitest";
import { search, type SearchDb, type WorkPointRow } from "../src/api/search";

/**
 * Unit tests for the Catalog `search` read API (catalog/src/api/search.ts).
 *
 * `search` takes the narrow `SearchDb` port (the minimal surface it calls), so
 * these inject a typed in-memory fake instead of a real container — the same DI
 * convention sources.worker.test.ts uses for `FetchLike`. We assert: a known
 * alias maps points to the contract `PilgrimagePoint` shape; an unknown alias
 * returns empty rows; and the query is NFKC-normalized before the alias lookup.
 * Pure logic; named *.worker.test.ts so the vitest-pool-workers config picks it
 * up.
 */

const ROW: WorkPointRow = {
  id: "spot-1",
  name: "鷲宮神社",
  name_cn: "鹫宫神社",
  bangumi_id: "1",
  episode: 3,
  time_seconds: 120,
  image: "https://image.anitabi.cn/p1.jpg",
  latitude: 36.1019,
  longitude: 139.6586,
  title: "らき☆すた",
  title_cn: "幸运星",
  synced_at: new Date("2026-06-20T00:00:00.000Z"),
};

/** Build a typed `SearchDb` fake keyed by normalized alias, recording lookups. */
function fakeDb(
  aliasIndex: Record<string, { workId: string; rows: WorkPointRow[] }>,
): { db: SearchDb; lookups: string[] } {
  const lookups: string[] = [];
  const db: SearchDb = {
    workIdForAlias: async (alias) => {
      lookups.push(alias);
      return aliasIndex[alias]?.workId;
    },
    pointsForWork: async (workId) =>
      Object.values(aliasIndex).find((e) => e.workId === workId)?.rows ?? [],
  };
  return { db, lookups };
}

describe("search (alias resolve)", () => {
  it("maps a known alias to PilgrimagePoint rows in contract shape", async () => {
    const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      id: "spot-1",
      name: "鷲宮神社",
      name_cn: "鹫宫神社",
      bangumi_id: "1",
      episode: 3,
      time_seconds: 120,
      screenshot_url: "https://image.anitabi.cn/p1.jpg",
      latitude: 36.1019,
      longitude: 139.6586,
      title: "らき☆すた",
      title_cn: "幸运星",
    });
  });

  it("returns synced_at from the work's bangumi.updated_at", async () => {
    const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.synced_at).toBe("2026-06-20T00:00:00.000Z");
  });

  it("returns empty rows when the alias does not resolve", async () => {
    const { db } = fakeDb({});
    const result = await search(db, { query: "unknown anime" });
    expect(result.rows).toEqual([]);
    expect(typeof result.synced_at).toBe("string");
  });

  it("NFKC-normalizes the query before the alias lookup", async () => {
    const { db, lookups } = fakeDb({});
    await search(db, { query: "  ＦＡＴＥ  " });
    expect(lookups).toEqual(["fate"]);
  });

  it("omits optional fields that are null in the DB row", async () => {
    const bare: WorkPointRow = {
      ...ROW,
      name_cn: null,
      episode: null,
      time_seconds: null,
      image: null,
      title: null,
      title_cn: null,
      synced_at: null,
    };
    const { db } = fakeDb({ "lucky star": { workId: "1", rows: [bare] } });
    const result = await search(db, { query: "lucky star" });
    expect(result.rows[0]).toEqual({
      id: "spot-1",
      name: "鷲宮神社",
      bangumi_id: "1",
      screenshot_url: "",
      latitude: 36.1019,
      longitude: 139.6586,
    });
  });
});
