import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beginRunRow, recordRunRow } from "../src/ingest/run-store";
import type { CatalogDb } from "../src/db/client";
import type { RunSnapshot } from "../src/ingest/daily-run";
describe("Run reservation (AC1)", () => {
  it("acquires a fresh or resumed reservation and returns true", async () => {
    const { db, sqlText } = fakeDb([{ run_id: "daily-x" }]);
    const acquired = await beginRunRow(db, "daily-x");
    expect(acquired).toBe(true);
    expect(sqlText[0]).toMatch(/do update/);
    expect(sqlText[0]).toContain("<> 'running'");
    expect(sqlText[0]).toContain("returning");
  });

  it("does not acquire when another invocation already holds the run", async () => {
    const { db } = fakeDb([]);
    const acquired = await beginRunRow(db, "daily-x");
    expect(acquired).toBe(false);
  });

  it("serializes each jsonb snapshot field exactly once", async () => {
    const { db, params } = fakeDb([]);
    await recordRunRow(db, "daily-1", snapshot());
    const parsed = params.map((p) => tryParse(p));
    expect(parsed).toContainEqual({ works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 });
    expect(parsed).toContainEqual({ bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } });
    expect(parsed).toContainEqual({ workUsed: 1, requestUsed: 2, runtimeUsedMs: 3, firstExhausted: null });
    expect(parsed).toContainEqual([]);
    expect(parsed).toContainEqual({});
  });
});

/** Parse a JSON string without throwing on non-JSON values. */
function tryParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function fakeDb(rows: unknown[]): { db: CatalogDb; sqlText: string[]; params: unknown[] } {
  const sqlText: string[] = [];
  const params: unknown[] = [];
  const execute = vi.fn((query: SQL) => {
    const c = new PgDialect().sqlToQuery(query);
    sqlText.push(c.sql);
    params.push(...c.params);
    return Promise.resolve({ rows });
  });
  return { db: { execute } as unknown as CatalogDb, sqlText, params };
}

function snapshot(): RunSnapshot {
  return {
    status: "running",
    targets: { works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 },
    sources: { bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } },
    budgetUsed: { workUsed: 1, requestUsed: 2, runtimeUsedMs: 3 },
    firstExhausted: null,
    failures: [],
    published: {},
    startedAtMs: null,
  };
}
