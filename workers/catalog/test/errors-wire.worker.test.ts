import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import { catalogRouter, type CatalogContext } from "../src/router";
import type { CatalogDb, NeonSql } from "../src/db/client";
import type {
  RouteTooManyClustersData,
  RouteTooManyPointsData,
  UpstreamUnavailableData,
  WorkNotFoundData,
} from "../src/lib/errors";

interface ErrorEnvelope<TData> {
  defined: true;
  code: string;
  status: number;
  message: string;
  data: TData;
}

interface RouteRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  origin: string | null;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
}

const handler = new OpenAPIHandler(catalogRouter);

/** Call the catalog OpenAPI handler directly with a typed fake context. */
async function call(path: string, body: unknown, context: CatalogContext): Promise<Response> {
  const req = new Request(`https://catalog.test/catalog/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const { matched, response } = await handler.handle(req, { context });
  expect(matched).toBe(true);
  if (!response) throw new Error("expected OpenAPI handler response");
  return response;
}

/** Context that wins ingest singleflight and records the subsequent failure. */
function ingestContext(fetchImpl: typeof fetch): CatalogContext {
  let calls = 0;
  const execute = () => Promise.resolve({ rows: calls++ === 0 ? [{ work_id: "3302" }] : [] });
  const db = { execute } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql, fetchImpl };
}

/** Bangumi succeeds; Anitabi fails so the typed source label is deterministic. */
function anitabiOutage(): typeof fetch {
  const fetchImpl = (input: string) => input.includes("api.bgm.tv")
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 3302 }) })
    : Promise.reject(new Error("anitabi down"));
  return fetchImpl as unknown as typeof fetch;
}

/** Build a minimal CatalogContext; casts stay at the test fake boundary. */
function context(rows: unknown[], fetchImpl?: typeof fetch): CatalogContext {
  const db = { execute: () => Promise.resolve({ rows }) } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql, fetchImpl };
}

/** Context whose DB must not be touched. */
function unreachableContext(): CatalogContext {
  const db = { execute: () => { throw new Error("db should not be reached"); } } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql };
}

/** Joined point+bangumi rows spaced far enough apart to produce distinct clusters. */
function routeRows(count: number): RouteRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${String(i).padStart(3, "0")}`, name: `P${String(i)}`, name_cn: null,
    bangumi_id: "k", episode: null, time_seconds: null, image: null,
    latitude: 35 + i * 0.001, longitude: 135, origin: null,
    title: "Lucky Star", title_cn: "幸运星", cover_url: "cover.jpg",
  }));
}

async function json<TData>(response: Response): Promise<ErrorEnvelope<TData>> {
  return await response.json();
}

describe("catalog input validation on the OpenAPI wire", () => {
  it("rejects wrong-typed nearby input before SQL", async () => {
    const malformed = await call("nearby", { lat: "36.1", lng: 139.6, radius_m: 5000 }, unreachableContext());
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ defined: false, status: 400 });
  });

  it("rejects out-of-range nearby latitude before SQL", async () => {
    const response = await call("nearby", { lat: 91, lng: 139.6, radius_m: 5000 }, unreachableContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
  });

  it("rejects zero nearby radius before SQL", async () => {
    const response = await call("nearby", { lat: 36.1, lng: 139.6, radius_m: 0 }, unreachableContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
  });

  it("accepts in-range nearby input", async () => {
    const valid = await call("nearby", { lat: 36.1, lng: 139.6, radius_m: 5000 }, context([]));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ rows: [] });
  });

});

describe("catalog typed errors on the OpenAPI wire", () => {
  it("serializes ROUTE_TOO_MANY_POINTS for route input over the router cap", async () => {
    const point_ids = Array.from({ length: 501 }, (_, i) => `p${String(i)}`);
    const res = await call("route", { point_ids }, unreachableContext());
    expect(res.status).toBe(400);
    expect(await json<RouteTooManyPointsData>(res)).toEqual({
      defined: true, code: "ROUTE_TOO_MANY_POINTS", status: 400,
      message: "Too many point_ids for a single route",
      data: { point_count: 501, max_points: 500 },
    });
  });

  it("serializes ROUTE_TOO_MANY_CLUSTERS after clustering selected points", async () => {
    const rows = routeRows(51);
    const point_ids = rows.map((r) => r.id);
    const res = await call("route", { point_ids }, context(rows));
    expect(res.status).toBe(422);
    expect(await json<RouteTooManyClustersData>(res)).toEqual({
      defined: true, code: "ROUTE_TOO_MANY_CLUSTERS", status: 422,
      message: "Route exceeds the maximum number of areas",
      data: { cluster_count: 51, max_clusters: 50 },
    });
  });

  it("serializes WORK_NOT_FOUND for a spots miss", async () => {
    const res = await call("spots", { bangumi_id: "missing-work" }, context([]));
    expect(res.status).toBe(404);
    expect(await json<WorkNotFoundData>(res)).toEqual({
      defined: true, code: "WORK_NOT_FOUND", status: 404,
      message: "No pilgrimage points for this work",
      data: { bangumi_id: "missing-work" },
    });
  });

  it("serializes UPSTREAM_UNAVAILABLE for a search alias miss with Bangumi down", async () => {
    const fetchImpl = (() => Promise.reject(new Error("bangumi down"))) as unknown as typeof fetch;
    const res = await call("search", { query: "unknown title" }, context([], fetchImpl));
    expect(res.status).toBe(502);
    expect(await json<UpstreamUnavailableData>(res)).toEqual({
      defined: true, code: "UPSTREAM_UNAVAILABLE", status: 502,
      message: "Upstream catalog source unavailable",
      data: { upstream: "bangumi" },
    });
  });
});

describe("catalog ingest typed errors on the OpenAPI wire", () => {
  it("serializes defined UPSTREAM_UNAVAILABLE when ingest cannot reach Anitabi", async () => {
    const res = await call("ingest", { bangumi_id: "3302" }, ingestContext(anitabiOutage()));
    expect(res.status).toBe(502);
    expect(await json<UpstreamUnavailableData>(res)).toEqual({
      defined: true, code: "UPSTREAM_UNAVAILABLE", status: 502,
      message: "Upstream catalog source unavailable",
      data: { upstream: "anitabi" },
    });
  });
});
