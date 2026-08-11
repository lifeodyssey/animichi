import { OpenAPIHandler } from "@orpc/openapi/fetch";
import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import type { CatalogDb, NeonSql } from "../src/db/client";
import { catalogRouter, type CatalogContext } from "../src/router";

const handler = new OpenAPIHandler(catalogRouter);

function context(responses: unknown[][], fetchImpl?: typeof fetch): CatalogContext {
  const execute = () => Promise.resolve({ rows: responses.shift() ?? [] });
  const db = { execute } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql, fetchImpl };
}

async function call(path: string, body: unknown, ctx: CatalogContext): Promise<Response> {
  const result = await handleRequest(path, body, ctx);
  expect(result.matched).toBe(true);
  assert(result.response);
  return result.response;
}

async function handleRequest(path: string, body: unknown, ctx: CatalogContext) {
  const request = new Request(`https://catalog.test/catalog/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handler.handle(request, { context: ctx });
}

/** A Bangumi-search `fetch` stub returning a JSON body with the given status. */
function bangumiStub(status: number, body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe("resolve input validation through the published route", () => {
  it.each(["", " \t\n"])("rejects a blank resolve query before upstream fetch: %j", async (query) => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error("upstream must not run")));

    const response = await call("resolve", { query }, context([], fetchImpl));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolve exact and alias outcomes through the published route", () => {
  it("serves the deterministic resolve outcome", async () => {
    const response = await call("resolve", { query: "Lucky Star" }, context([
      [{ bangumi_id: "3302", priority: 40 }],
      [{
        id: "3302", title: "らき☆すた", title_cn: "幸运星",
        cover_url: null, air_date: "2007-04-08", points_count: "0",
      }],
    ]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "resolved",
      match: {
        bangumi_id: "3302", title: "らき☆すた", title_cn: "幸运星",
        year: 2007, points_count: 0,
      },
    });
  });

  it("serves an exact alias hit without touching upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error("upstream must not run")));

    const response = await call("resolve", { query: "Lucky Star" }, context([
      [{ bangumi_id: "3302", priority: 40 }],
      [{ id: "3302", title: "らき☆すた", title_cn: null, cover_url: null, air_date: null, points_count: "0" }],
    ], fetchImpl));

    expect(response.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ outcome: "resolved" });
  });

  it("serves ambiguity for tied alias works", async () => {
    const response = await call("resolve", { query: "Shared" }, context([
      [
        { bangumi_id: "200", priority: 40 },
        { bangumi_id: "100", priority: 40 },
      ],
      [
        { id: "200", title: "Two", title_cn: null, cover_url: null, air_date: null, points_count: "7" },
        { id: "100", title: "One", title_cn: null, cover_url: null, air_date: null, points_count: "3" },
      ],
    ]));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "200" }, { bangumi_id: "100" }],
    });
  });
});

describe("resolve upstream outcomes through the published route", () => {
  it("returns not_found when the alias misses and upstream is empty", async () => {
    const fetchImpl = bangumiStub(200, { data: [] });

    const response = await call("resolve", { query: "unknown" }, context([], fetchImpl));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "not_found", reason: "anime_not_found" });
  });

  it("resolves through upstream ingest on an alias miss", async () => {
    const fetchImpl = bangumiStub(200, { data: [{ id: 20, name: "Fate/Zero" }] });

    const response = await call("resolve", { query: "fate" }, context([], fetchImpl));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20", title: "Fate/Zero" },
    });
  });

  it("surfaces upstream failure as upstream_unavailable", async () => {
    const fetchImpl = bangumiStub(503, null);

    const response = await call("resolve", { query: "outage" }, context([], fetchImpl));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "upstream_unavailable", provider: "bangumi" });
  });
});

describe("points-by-bangumi-id through the published route", () => {
  it("serves published rows directly by work id", async () => {
    const point = {
      id: "p1", name: "Shrine", name_cn: null, bangumi_id: "3302",
      episode: null, time_seconds: null, image: null, latitude: 35, longitude: 135,
      title: "らき☆すた", title_cn: null, cover_url: null,
      synced_at: "2026-07-16T00:00:00.000Z",
    };
    const response = await call("points-by-bangumi-id", { bangumi_id: "3302" }, context([[point]]));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [{ id: "p1", bangumi_id: "3302" }],
      synced_at: "2026-07-16T00:00:00.000Z",
    });
  });
});
