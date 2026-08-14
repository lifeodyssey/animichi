/**
 * Popular-bangumi adapter + bounds tests (CATALOG-5 #946).
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { popularBangumiDb, type PopularBangumiDb } from "../src/adapters/outbound/popular-bangumi";

type Row = Record<string, unknown>;

function fakeDb(rows: Row[]): PopularBangumiDb {
  return { execute: () => Promise.resolve({ rows }) };
}

function sqlText(query: ReturnType<typeof sql>): string {
  return new PgDialect().sqlToQuery(query).sql;
}

function row(overrides: Partial<Row> = {}): Row {
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
    const rows = await popularBangumiDb(fakeDb([row()])).listPopular(8);
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

  it("coerces null optional fields", async () => {
    const rows = await popularBangumiDb(fakeDb([row({ title_cn: null, cover_url: null, city: null, rating: null })])).listPopular(8);
    expect(rows[0]).toMatchObject({ title_cn: null, cover_url: null, city: null, rating: null });
  });

  it("forwards the limit into the query", async () => {
    let captured = "";
    const db: PopularBangumiDb = {
      execute: (query) => {
        captured = sqlText(query);
        return Promise.resolve({ rows: [row()] });
      },
    };
    await popularBangumiDb(db).listPopular(5);
    expect(captured).toContain("limit");
    expect(captured).toMatch(/limit \$\d+/);
  });

  it("orders rating DESC NULLS LAST and filters zero points", async () => {
    let captured = "";
    const db: PopularBangumiDb = {
      execute: (query) => {
        captured = sqlText(query);
        return Promise.resolve({ rows: [row()] });
      },
    };
    await popularBangumiDb(db).listPopular(8);
    expect(captured).toContain("DESC NULLS LAST");
    expect(captured).toContain("rating");
    expect(captured).toContain("points_count");
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

describe("popularBangumiDb edge rows", () => {
  it("coerces non-string optional fields to null/empty", async () => {
    const rows = await popularBangumiDb(fakeDb([row({ title_cn: 123 as unknown as string, cover_url: null, city: null })])).listPopular(8);
    expect(rows[0]).toMatchObject({ title_cn: null, cover_url: null, city: null });
  });
});
