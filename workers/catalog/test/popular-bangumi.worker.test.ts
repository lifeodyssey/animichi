/**
 * Popular-bangumi adapter + bounds tests (CATALOG-5 #946; Prisma data plane #1629).
 *
 * The adapter is now handed a {@link CatalogPrisma}, so the seam under test is
 * `test/fakes/fake-catalog-prisma.ts`: the REAL contract-bound builder plus an
 * executor answering scripted rows. Building the plan against the real builder is
 * what keeps the fixture honest — a column the contract does not declare fails
 * here exactly as it would in the Worker.
 *
 * The row-mapping assertions the Drizzle version carried are gone with the
 * mapping: the plan's projection IS the row type, so there is no untyped row to
 * coerce and nothing left to narrow.
 */

import { describe, expect, it } from "vitest";
import { popularBangumiDb, type PopularBangumiRow } from "../src/adapters/outbound/popular-bangumi";
import { countingCatalogPrisma, fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

function row(overrides: Partial<PopularBangumiRow> = {}): PopularBangumiRow {
  return {
    id: "1",
    title: "Your Name",
    title_cn: "你的名字",
    cover_url: "https://cdn/1.jpg",
    city: "Tokyo",
    points_count: 12,
    rating: 9.1,
    ...overrides,
  };
}

describe("popularBangumiDb", () => {
  it("maps rows to contract-shaped PopularBangumi", async () => {
    const rows = await popularBangumiDb(fakeCatalogPrisma([row()])).listPopular(8);
    expect(rows[0]).toEqual({
      id: "1",
      title: "Your Name",
      title_cn: "你的名字",
      cover_url: "https://cdn/1.jpg",
      city: "Tokyo",
      points_count: 12,
      rating: 9.1,
    });
  });

  it("passes null optional fields through untouched", async () => {
    const rows = await popularBangumiDb(
      fakeCatalogPrisma([row({ title_cn: null, cover_url: null, city: null, rating: null })]),
    ).listPopular(8);
    expect(rows[0]).toMatchObject({ title_cn: null, cover_url: null, city: null, rating: null });
  });

  it("issues the capped ranking read as one statement and maps the returned row", async () => {
    const counter = countingCatalogPrisma([row()]);
    await expect(popularBangumiDb(counter.query).listPopular(5)).resolves.toEqual([row()]);
    expect(counter.statements()).toBe(1);
  });

  it("issues exactly one ranking read and preserves the returned work order", async () => {
    const ranked = [row({ id: "2", rating: 9.5 }), row({ id: "1", rating: 9.1 })];
    const counter = countingCatalogPrisma(ranked);
    await expect(popularBangumiDb(counter.query).listPopular(8)).resolves.toEqual(ranked);
    expect(counter.statements()).toBe(1);
  });

  it("returns the rows the runtime answered with a fresh array, not the runtime's list", async () => {
    const answered = [row()];
    const rows = await popularBangumiDb(fakeCatalogPrisma(answered)).listPopular(8);
    expect(rows).toEqual(answered);
    expect(rows).not.toBe(answered);
  });
});

describe("popular procedure bounds", () => {
  it("rejects limit 0 via the contract zod input", async () => {
    const { PopularInput } = await import("@animichi/contract");
    expect(() => PopularInput.parse({ limit: 0 })).toThrow();
    expect(() => PopularInput.parse({ limit: 51 })).toThrow();
  });

  it("accepts the default and boundary limits", async () => {
    const { PopularInput } = await import("@animichi/contract");
    expect(PopularInput.parse({}).limit).toBe(8);
    expect(PopularInput.parse({ limit: 1 }).limit).toBe(1);
    expect(PopularInput.parse({ limit: 50 }).limit).toBe(50);
  });
});
