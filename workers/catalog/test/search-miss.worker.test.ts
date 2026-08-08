import { describe, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import { upstreamUnavailable } from "../src/lib/errors";
import type { FetchLike } from "../src/ingest/sources";
import { fakeDb, type AliasIndex, ROW, catalogDb } from "./in-memory-search-db";
import { PREVIEW_POINT } from "./fixtures/l1-preview-point";
import { searchError } from "./search-contract-asserts";

describe("search (alias miss — upstream errors)", () => {
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

describe("search (alias miss — production SearchDb wrapper)", () => {
  it("runs the sync fallback through the real runFullIngest when the preview resolves", async () => {
    const fetchImpl: FetchLike = (url) =>
      url.includes("/v0/search/subjects")
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 10380 }] }) })
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              pointsLength: 1,
              litePoints: [{ id: "lite-1", name: "宇治橋", geo: [34.8915, 135.8078], image: "/lite/p1.jpg", ep: 1, s: 12 }],
            }),
          });

    const result = await search(
      searchDb(catalogDb([])),
      { query: "けいおん！" },
      { fetchImpl },
    );

    expect(result.partial).toBe(true);
    expect(result.rows.map((r) => r.id)).toEqual(["lite-1"]);
  });
});

describe("search (alias miss — Anitabi lite 404 = no data, not an outage)", () => {
  const bangumiHit = { ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 10380 }] }) };

  it("returns empty rows (no UPSTREAM_UNAVAILABLE) when Anitabi has no data (404)", async () => {
    const fetchImpl: FetchLike = (url) =>
      url.includes("/v0/search/subjects")
        ? Promise.resolve(bangumiHit)
        : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });

    const result = await search(searchDb(catalogDb([])), { query: "work with no anitabi data" }, { fetchImpl });

    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect(typeof result.synced_at).toBe("string");
  });

  it("still maps a real Anitabi 5xx outage to a retryable UPSTREAM_UNAVAILABLE", async () => {
    const fetchImpl: FetchLike = (url) =>
      url.includes("/v0/search/subjects")
        ? Promise.resolve(bangumiHit)
        : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) });

    const err = await searchError(() =>
      search(searchDb(catalogDb([])), { query: "anitabi outage" }, { fetchImpl }),
    );

    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.status).toBe(502);
    expect(err.defined).toBe(true);
    expect(err.data).toEqual({ upstream: "anitabi" });
  });
});
