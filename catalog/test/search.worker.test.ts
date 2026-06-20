import { describe, expect, it } from "vitest";
import { search, type SearchDb, type WorkPointRow } from "../src/api/search";

/**
 * Unit tests for the Catalog `search` read API (catalog/src/api/search.ts).
 *
 * `search` takes the narrow `SearchDb` port (the minimal surface it calls), so
 * these inject a typed in-memory fake instead of a real container — the same DI
 * convention sources.worker.test.ts uses for `FetchLike`. We assert: a known
 * alias maps points to the contract `PilgrimagePoint` shape; an unknown alias
 * triggers the on-demand resolve+ingest miss path (and returns the ingested
 * points, or empty rows when Bangumi can't resolve the title); and the query is
 * NFKC-normalized before the alias lookup. Pure logic; named *.worker.test.ts so
 * the vitest-pool-workers config picks it up.
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

/** Index of works keyed by normalized alias; `ingest` lazily publishes a work. */
type AliasIndex = Record<string, { workId: string; rows: WorkPointRow[] }>;

/**
 * Build a typed `SearchDb` fake keyed by normalized alias, recording lookups and
 * resolve-and-ingest calls. `ingest` (optional) is the on-demand miss path: it
 * returns the resolved+published work id (and the test wires its rows in), or
 * null to model an unresolvable title.
 */
function fakeDb(
  aliasIndex: AliasIndex,
  ingest?: (query: string) => Promise<string | null>,
): { db: SearchDb; lookups: string[]; resolved: string[] } {
  const lookups: string[] = [];
  const resolved: string[] = [];
  const db: SearchDb = {
    workIdForAlias: async (alias) => recordLookup(lookups, aliasIndex, alias),
    pointsForWork: async (workId) =>
      Object.values(aliasIndex).find((e) => e.workId === workId)?.rows ?? [],
    resolveAndIngest: async (query) => {
      resolved.push(query);
      return ingest ? ingest(query) : null;
    },
  };
  return { db, lookups, resolved };
}

/** Record + resolve an alias lookup against the in-memory index. */
function recordLookup(lookups: string[], index: AliasIndex, alias: string): string | undefined {
  lookups.push(alias);
  return index[alias]?.workId;
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

  it("an alias HIT returns directly without the resolve-and-ingest miss path", async () => {
    const { db, resolved } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.rows).toHaveLength(1);
    expect(resolved).toEqual([]);
  });

  it("an alias MISS resolves+ingests the work, then returns its fresh points", async () => {
    const index: Record<string, { workId: string; rows: WorkPointRow[] }> = {};
    const { db, resolved } = fakeDb(index, async (query) => {
      index[query] = { workId: "10380", rows: [{ ...ROW, id: "fresh", bangumi_id: "10380" }] };
      return "10380";
    });
    const result = await search(db, { query: "けいおん！" });
    expect(resolved).toEqual(["けいおん！"]);
    expect(result.rows.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("returns empty rows when the alias miss cannot be resolved by Bangumi", async () => {
    const { db, resolved } = fakeDb({}, async () => null);
    const result = await search(db, { query: "unknown anime" });
    expect(result.rows).toEqual([]);
    expect(resolved).toEqual(["unknown anime"]);
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
