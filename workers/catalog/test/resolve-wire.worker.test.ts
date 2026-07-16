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
  const request = new Request(`https://catalog.test/catalog/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await handler.handle(request, { context: ctx });
  expect(result.matched).toBe(true);
  assert(result.response);
  return result.response;
}

describe("Phase 1a catalog procedures on the oRPC wire", () => {
  it.each(["", " \t\n"])("rejects a blank resolve query before upstream fetch: %j", async (query) => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error("upstream must not run")));

    const response = await call("resolve", { query }, context([], fetchImpl));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the deterministic resolve outcome", async () => {
    const response = await call("resolve", { query: "Lucky Star" }, context([
      [{ work_id: "3302", priority: 40 }],
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

  it("serves published rows directly by work id", async () => {
    const point = {
      id: "p1", name: "Shrine", name_cn: null, bangumi_id: "3302",
      episode: null, time_seconds: null, image: null, latitude: 35, longitude: 135,
      title: "らき☆すた", title_cn: null, cover_url: null,
      synced_at: "2026-07-16T00:00:00.000Z",
    };
    const response = await call("points-by-work-id", { work_id: "3302" }, context([[point]]));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [{ id: "p1", bangumi_id: "3302" }],
      synced_at: "2026-07-16T00:00:00.000Z",
    });
  });
});
