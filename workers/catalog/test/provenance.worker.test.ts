import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { captureProvenance, pointFieldMap, type ProvenanceRecord } from "../src/ingest/provenance";

describe("Point provenance field map (AC4)", () => {
  it("maps every published point field to the anitabi source", () => {
    const map = pointFieldMap();
    expect(map.id).toBe("anitabi");
    expect(map.name).toBe("anitabi");
    expect(map.latitude).toBe("anitabi");
    expect(map.longitude).toBe("anitabi");
    expect(map.image).toBe("anitabi");
  });

  it("includes each of the contributing point columns", () => {
    const map = pointFieldMap();
    expect(Object.keys(map).sort()).toEqual([
      "episode", "id", "image", "latitude", "longitude", "name", "name_cn", "time_seconds",
    ]);
  });
});

describe("Provenance UPSERT statement (AC4)", () => {
  it("refreshes captured_at so the latest capture wins", async () => {
    const statements: string[] = [];
    const db = fakeDb((sql) => statements.push(new PgDialect().sqlToQuery(sql).sql));
    await captureProvenance(db, record());
    expect(statements[0]).toContain("EXCLUDED.captured_at");
  });

  it("binds field_map as a single-encoded JSON document, not a string of a string", async () => {
    const params: unknown[] = [];
    const db = fakeDb((sql) => params.push(...new PgDialect().sqlToQuery(sql).params));
    await captureProvenance(db, record());
    const param = params.find((p) => typeof p === "string" && tryParse(p) !== null && Object.hasOwn(tryParse(p) as Record<string, unknown>, "name"));
    expect(param).not.toBeUndefined();
    expect(JSON.parse(param as string)).toEqual(record().fieldMap);
  });
});

/** Parse a JSON string without throwing on non-JSON values. */
function tryParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function fakeDb(capture: (sql: SQL) => void): CatalogDb {
  const execute = vi.fn((query: SQL) => {
    capture(query);
    return Promise.resolve({ rows: [] });
  });
  return { execute } as unknown as CatalogDb;
}

function record(): ProvenanceRecord {
  return {
    scope: "point",
    entityId: "p-1",
    workId: "prov-w",
    source: "anitabi",
    upstreamId: "p-1",
    attribution: "Anitabi",
    license: "https://anitabi.cn",
    fieldMap: { name: "anitabi", latitude: "anitabi" },
  };
}
