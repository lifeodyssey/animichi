import { describe, expect, it } from "vitest";
import {
  search,
  searchDb,
  type MissPreview,
  type SearchDb,
  type WorkPointRow,
} from "../src/api/search";
import { ORPCError } from "@orpc/server";
import type { CatalogDb } from "../src/db/client";
import { upstreamUnavailable } from "../src/lib/errors";
import type { FetchLike } from "../src/ingest/sources";
import type { PilgrimagePoint } from "../src/types";

/**
 * Unit tests for the Catalog `search` read API (catalog/src/api/search.ts).
 *
 * `search` takes the narrow `SearchDb` port (the minimal surface it calls), so
 * these inject a typed in-memory fake instead of a real container. We assert:
 * a known alias maps points to the contract `PilgrimagePoint` shape; the query
 * is NFKC-normalized before the lookup; and — the focus of this card — that an
 * alias MISS is TIERED so workerd never blocks on the full ingest:
 *   - with a `waitUntil`: the L1 lite preview returns FAST (no awaiting the full
 *     ingest), `partial:true` is set, and the full ingest is SCHEDULED on
 *     `waitUntil` (asserted via a spy that collects the scheduled promise);
 *   - awaiting that captured promise then runs the full ingest;
 *   - without a `waitUntil`: it falls back to the prior synchronous behavior.
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
  cover_url: "https://image.anitabi.cn/cover1.jpg",
  synced_at: new Date("2026-06-20T00:00:00.000Z"),
};

/** Index of works keyed by normalized alias (the published catalog). */
type AliasIndex = Record<string, { workId: string; rows: WorkPointRow[] }>;

/** The miss-path stubs a test can wire: resolve a preview + run the full ingest. */
interface MissStubs {
  resolvePreview?: (query: string) => Promise<MissPreview | null>;
  runFullIngest?: (workId: string) => Promise<void>;
}

/** What a `fakeDb` records, for assertions. */
interface Recorder {
  db: SearchDb;
  lookups: string[];
  resolved: string[];
  ingested: string[];
}

/**
 * Build a typed `SearchDb` fake keyed by normalized alias, recording lookups,
 * preview-resolves, and full-ingest calls. The miss stubs default to a null
 * preview (unresolvable title) and a no-op ingest.
 */
function fakeDb(aliasIndex: AliasIndex, miss: MissStubs = {}): Recorder {
  const lookups: string[] = [];
  const resolved: string[] = [];
  const ingested: string[] = [];
  const db: SearchDb = {
    workIdForAlias: (alias) => Promise.resolve(recordLookup(lookups, aliasIndex, alias)),
    pointsForWork: (workId) =>
      Promise.resolve(Object.values(aliasIndex).find((e) => e.workId === workId)?.rows ?? []),
    resolvePreview: async (query) => {
      resolved.push(query);
      // `await` (not a bare return) so a stub's already-rejected promise gains
      // a handler synchronously — workerd reports rejections left dangling
      // across the thenable-adoption microtask as unhandled.
      return miss.resolvePreview ? await miss.resolvePreview(query) : null;
    },
    runFullIngest: async (workId) => {
      if (miss.runFullIngest) await miss.runFullIngest(workId);
      ingested.push(workId);
    },
  };
  return { db, lookups, resolved, ingested };
}

/** Record + resolve an alias lookup against the in-memory index. */
function recordLookup(lookups: string[], index: AliasIndex, alias: string): string | undefined {
  lookups.push(alias);
  return index[alias]?.workId;
}

/** A `waitUntil` spy that collects every scheduled promise for later awaiting. */
function waitUntilSpy(): { waitUntil: (p: Promise<unknown>) => void; scheduled: Promise<unknown>[] } {
  const scheduled: Promise<unknown>[] = [];
  return { waitUntil: (p) => void scheduled.push(p), scheduled };
}

/** Fake production DB for searchDb() alias misses; casts stay at the boundary. */
function catalogDb(rows: unknown[]): CatalogDb {
  return { execute: () => Promise.resolve({ rows }) } as unknown as CatalogDb;
}

async function searchError(run: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ORPCError);
    return err as ORPCError<string, unknown>;
  }
  throw new Error("expected search to reject");
}

/** A canned L1 preview point (the lite shape, already mapped to the contract). */
const PREVIEW_POINT: PilgrimagePoint = {
  id: "lite-1",
  name: "宇治橋",
  bangumi_id: "10380",
  screenshot_url: "https://image.anitabi.cn/lite1.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
  episode: 1,
};

async function assertContractShape(): Promise<void> {
  const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
  const result = await search(db, { query: "Lucky Star" });
  expect(result.rows).toHaveLength(1);
  expect(result.partial).toBeUndefined();
  expect(result.rows[0]).toEqual({
    id: "spot-1", name: "鷲宮神社", name_cn: "鹫宫神社", bangumi_id: "1",
    episode: 3, time_seconds: 120, screenshot_url: "https://image.anitabi.cn/p1.jpg",
    latitude: 36.1019, longitude: 139.6586, title: "らき☆すた", title_cn: "幸运星",
    cover_url: "https://image.anitabi.cn/cover1.jpg",
  });
}

async function assertNullFieldsOmitted(): Promise<void> {
  const bare: WorkPointRow = {
    ...ROW, name_cn: null, episode: null, time_seconds: null,
    image: null, title: null, title_cn: null, cover_url: null, synced_at: null,
  };
  const { db } = fakeDb({ "lucky star": { workId: "1", rows: [bare] } });
  const result = await search(db, { query: "lucky star" });
  expect(result.rows[0]).toEqual({
    id: "spot-1", name: "鷲宮神社", bangumi_id: "1",
    screenshot_url: "", latitude: 36.1019, longitude: 139.6586,
  });
}

describe("search (alias hit)", () => {
  it("maps a known alias to PilgrimagePoint rows in contract shape", assertContractShape);

  it("returns synced_at from the work's bangumi.updated_at", async () => {
    const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.synced_at).toBe("2026-06-20T00:00:00.000Z");
  });

  it("an alias HIT returns directly without resolving a preview or ingesting", async () => {
    const { db, resolved, ingested } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.rows).toHaveLength(1);
    expect(resolved).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it("NFKC-normalizes the query before the alias lookup", async () => {
    const { db, lookups } = fakeDb({});
    await search(db, { query: "  ＦＡＴＥ  " });
    expect(lookups).toEqual(["fate"]);
  });

  it("omits optional fields that are null in the DB row", assertNullFieldsOmitted);
});

describe("search (alias miss — L1 preview + background ingest)", () => {
  it("returns the L1 lite preview FAST and schedules the full ingest on waitUntil", async () => {
    const { db, resolved, ingested } = fakeDb(
      {},
      { resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }) },
    );
    const { waitUntil, scheduled } = waitUntilSpy();

    const result = await search(db, { query: "けいおん！" }, { waitUntil });

    expect(result.rows).toEqual([PREVIEW_POINT]); // immediate L1 preview, not published rows
    expect(result.partial).toBe(true);
    expect(resolved).toEqual(["けいおん！"]);
    expect(scheduled).toHaveLength(1); // full ingest handed to waitUntil (backgrounded)
    void ingested; // completion is asserted in the "when awaited" test below
  });

  it("the scheduled promise runs the full ingest when awaited", async () => {
    const { db, ingested } = fakeDb(
      {},
      { resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }) },
    );
    const { waitUntil, scheduled } = waitUntilSpy();

    await search(db, { query: "けいおん！" }, { waitUntil });
    await Promise.all(scheduled); // drain the backgrounded work

    expect(ingested).toEqual(["10380"]);
  });

  it("returns empty rows when the title cannot be resolved to a preview", async () => {
    const { db, resolved, ingested } = fakeDb({}, { resolvePreview: () => Promise.resolve(null) });
    const { waitUntil, scheduled } = waitUntilSpy();

    const result = await search(db, { query: "unknown anime" }, { waitUntil });

    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect(resolved).toEqual(["unknown anime"]);
    expect(scheduled).toEqual([]);
    expect(ingested).toEqual([]);
    expect(typeof result.synced_at).toBe("string");
  });

  it("propagates a defined upstream error from the injected preview resolver", async () => {
    const { db } = fakeDb({}, { resolvePreview: () => Promise.reject(upstreamUnavailable("bangumi")) });
    const err = await searchError(() => search(db, { query: "downstream miss" }));
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.status).toBe(502);
    expect(err.defined).toBe(true);
    expect(err.data).toEqual({ upstream: "bangumi" });
  });

  it("turns production Bangumi fetch failures into defined retryable errors", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("bangumi down"));
    const err = await searchError(() =>
      search(searchDb(catalogDb([])), { query: "uncovered title" }, { fetchImpl }),
    );
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.status).toBe(502);
    expect(err.defined).toBe(true);
    expect(err.data).toEqual({ upstream: "bangumi" });
  });
});

describe("search (alias miss — synchronous fallback when no waitUntil)", () => {
  it("runs the full ingest synchronously, then returns the published points", async () => {
    const index: AliasIndex = {};
    const { db, ingested } = fakeDb(index, {
      resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }),
      runFullIngest: (workId) => {
        index.__ = { workId, rows: [{ ...ROW, id: "fresh", bangumi_id: workId }] };
        return Promise.resolve();
      },
    });

    const result = await search(db, { query: "けいおん！" });

    expect(ingested).toEqual(["10380"]); // ingest awaited inline
    expect(result.rows.map((r) => r.id)).toEqual(["fresh"]); // published points, not the preview
    expect(result.partial).toBeUndefined();
  });

  it("falls back to the preview when the synchronous ingest published nothing", async () => {
    const { db } = fakeDb(
      {},
      { resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }) },
    );

    const result = await search(db, { query: "けいおん！" });

    expect(result.rows).toEqual([PREVIEW_POINT]);
    expect(result.partial).toBe(true);
  });
});
