/**
 * CATALOG-2: `PointsByBangumi` — ordered published points through ONE Neon
 * read port.
 *
 * Covers the application use case (`application/list-points-for-bangumi.ts`),
 * its outbound adapter (`adapters/outbound/bangumi-points.ts`, the only
 * SQL on the path), and the OpenAPI route seam end to end.
 *
 * Ordering contract (the "requested ordering" the adapter must emit): scene
 * order — `ORDER BY p.episode ASC, p.time_seconds ASC, p.id ASC`.
 */

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import { catalogRouter, type CatalogContext } from "../src/router";
import { countingCatalogPrisma, fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";
import {
  pointsByBangumi,
  type PointsByBangumiPort,
  type PublishedPointRow,
} from "../src/application/list-points-for-bangumi";
import { bangumiPoints } from "../src/adapters/outbound/bangumi-points";

const ROW: PublishedPointRow = {
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
  city: "Kuki",
  origin: "バンダイチャンネル",
  origin_url: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
  synced_at: "2026-06-20T00:00:00.000Z",
};

function fakePort(rows: PublishedPointRow[]): PointsByBangumiPort {
  return { pointsForBangumi: () => Promise.resolve(rows) };
}

describe("pointsByBangumi use case", () => {
  it("returns the port's rows in the requested scene order", async () => {
    const ordered = [
      { ...ROW, id: "ep1" },
      { ...ROW, id: "ep2" },
      { ...ROW, id: "ep3" },
    ];
    const result = await pointsByBangumi(fakePort(ordered), "1");
    expect(result.rows.map((point) => point.id)).toEqual(["ep1", "ep2", "ep3"]);
  });

  it("maps a row to the contract Point shape", async () => {
    const result = await pointsByBangumi(fakePort([ROW]), "1");
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
      cover_url: "https://image.anitabi.cn/cover1.jpg",
      city: "Kuki",
      origin: "バンダイチャンネル",
      origin_url: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
    });
    expect(result.partial).toBeUndefined();
  });

  it("derives synced_at from the first row's bangumi.updated_at", async () => {
    const result = await pointsByBangumi(fakePort([ROW]), "1");
    expect(result.synced_at).toBe("2026-06-20T00:00:00.000Z");
  });

  it("returns an empty result for a missing bangumi without erroring", async () => {
    const result = await pointsByBangumi(fakePort([]), "999999");
    expect(result.rows).toEqual([]);
    expect(typeof result.synced_at).toBe("string");
    expect(result.partial).toBeUndefined();
  });
});

describe("bangumiPoints outbound adapter (ONE Prisma read)", () => {
  it("issues exactly one SELECT and preserves the returned scene order", async () => {
    const counter = countingCatalogPrisma([ROW]);
    await expect(bangumiPoints(counter.query).pointsForBangumi("1")).resolves.toEqual([ROW]);
    expect(counter.statements()).toBe(1);
  });

  it("hands back the plan's rows unchanged — the projection IS the row shape", async () => {
    await expect(bangumiPoints(fakeCatalogPrisma([ROW])).pointsForBangumi("1")).resolves.toEqual([ROW]);
  });

  it("returns an empty list for a bangumi with no rows (unknown or empty)", async () => {
    await expect(bangumiPoints(fakeCatalogPrisma([])).pointsForBangumi("999999")).resolves.toEqual([]);
  });

  it("returns a fresh array rather than the runtime's own list", async () => {
    const answered = [ROW];
    const rows = await bangumiPoints(fakeCatalogPrisma(answered)).pointsForBangumi("1");
    expect(rows).toEqual(answered);
    expect(rows).not.toBe(answered);
  });
});

describe("pointsByBangumiId route seam", () => {
  /** A context whose READ answers on the Prisma plane (#1631), one row-list per
   * `query()` in call order; the Drizzle seam is the ingest's (#1630) and here
   * it finds no parked job, so a work with no published rows takes the
   * uncovered-work path. */
  function context(rows: unknown[][]): CatalogContext {
    return { prisma: fakeCatalogPrisma(...rows) };
  }

  async function call(body: unknown, ctx: CatalogContext): Promise<Response> {
    const request = new Request("https://catalog.test/catalog/points-by-bangumi-id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const handler = new OpenAPIHandler(catalogRouter);
    const { matched, response } = await handler.handle(request, { context: ctx });
    expect(matched).toBe(true);
    if (!response) throw new Error("expected OpenAPI handler response");
    return response;
  }

  it("serves ordered published points for a bangumi id", async () => {
    const sceneOrder = [
      { ...ROW, id: "ep1", episode: 1, time_seconds: 60 },
      { ...ROW, id: "ep2", episode: 1, time_seconds: 300 },
      { ...ROW, id: "ep3", episode: 2, time_seconds: 30 },
    ];
    const response = await call({ bangumi_id: "1" }, context([sceneOrder]));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect((body as { rows: { id: string }[] }).rows.map((point) => point.id))
      .toEqual(["ep1", "ep2", "ep3"]);
  });

  it("reads the published rows on the Prisma plane — the Drizzle seam is never reached", async () => {
    const counter = countingCatalogPrisma([ROW]);
    const response = await call(
      { bangumi_id: "1" },
      { prisma: counter.query },
    );

    expect(response.status).toBe(200);
    expect(counter.statements()).toBe(1);
    const body = await response.json();
    expect((body as { rows: { id: string }[] }).rows.map((point) => point.id))
      .toEqual([ROW.id]);
  });
});
