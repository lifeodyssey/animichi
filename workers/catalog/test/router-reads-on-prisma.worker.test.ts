import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import type { GeocodeResult } from "../src/types";
import { catalogRouter, type CatalogContext } from "../src/router";
import { countingCatalogPrisma, fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * The two converted call sites whose routes had no wire test of their own
 * (#1631): `geocode` and `popular`.
 *
 * Every other route this card rewired (`search`, `resolve`, `spots`,
 * `points-by-bangumi-id`, `nearby`, `itinerary`, `anime-overview`) is driven
 * through the router by the wire test that owns it — `errors-wire`,
 * `resolve-wire`, `work-points-wire`, `points-by-bangumi`, `plan-itinerary`.
 * These two were named only by `router-surface.worker.test.ts`, which
 * enumerates procedures without calling them, so nothing proved they still
 * answer after their seam changed.
 *
 * The Drizzle seam is UNREACHABLE in both contexts: these routes read through
 * the request's Prisma runtime, and reaching `context.db` means the wiring went
 * back to the pre-#1631 shape.
 */
const handler = new OpenAPIHandler(catalogRouter);

/** The gazetteer's exact-tier row, as the plan projects it. */
const PLACE_ROW = {
  id: "seed:nishinomiya-station",
  name: "西宮駅",
  kind: "station",
  latitude: 34.7386,
  longitude: 135.3485,
  source: "manual",
  pref: "兵庫県",
  priority: 100,
};

/** One ranked work row, as the ranking plan projects it. */
const RANKED_ROW = {
  id: "3302",
  title: "らき☆すた",
  title_cn: "幸运星",
  cover_url: "https://cdn/3302.jpg",
  city: "Kuki",
  points_count: 12,
  rating: 8.4,
};

async function call(path: string, init: RequestInit, context: CatalogContext): Promise<Response> {
  const { matched, response } = await handler.handle(
    new Request(`https://catalog.test/catalog/${path}`, init),
    { context },
  );
  expect(matched).toBe(true);
  if (!response) throw new Error("expected OpenAPI handler response");
  return response;
}

function post(path: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("geocode reads the gazetteer on the Prisma plane", () => {
  it("answers the exact tier's candidate from the request's Prisma runtime", async () => {
    const counter = countingCatalogPrisma([PLACE_ROW]);

    const response = await call(
      "geocode",
      post("geocode", { query: "西宮" }),
      { prisma: counter.query },
    );

    expect(response.status).toBe(200);
    expect(counter.statements()).toBe(1);
    const body = await response.json() as GeocodeResult;
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      id: PLACE_ROW.id,
      name: PLACE_ROW.name,
      lat: PLACE_ROW.latitude,
      lng: PLACE_ROW.longitude,
      kind: PLACE_ROW.kind,
      source: PLACE_ROW.source,
    });
  });

  it("returns no candidates when both gazetteer tiers miss", async () => {
    const response = await call(
      "geocode",
      post("geocode", { query: "no-such-place" }),
      { prisma: fakeCatalogPrisma([], []) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidates: [] });
  });
});

describe("popular reads the ranking on the Prisma plane", () => {
  it("answers the ranking rows from the request's Prisma runtime", async () => {
    const counter = countingCatalogPrisma([RANKED_ROW]);

    const response = await call(
      "public/popular",
      { method: "GET" },
      { prisma: counter.query },
    );

    expect(response.status).toBe(200);
    expect(counter.statements()).toBe(1);
    expect(await response.json()).toEqual({
      bangumi: [{
        bangumi_id: RANKED_ROW.id,
        title: RANKED_ROW.title,
        title_cn: RANKED_ROW.title_cn,
        cover_url: RANKED_ROW.cover_url,
        city: RANKED_ROW.city,
        points_count: RANKED_ROW.points_count,
        rating: RANKED_ROW.rating,
      }],
    });
  });
});
