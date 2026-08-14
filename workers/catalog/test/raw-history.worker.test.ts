import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { cleanupRawHistory, DEFAULT_KEEP_COUNT } from "../src/ingest/raw_history";
import type { CatalogDb } from "../src/db/client";

interface FakeDb {
  db: CatalogDb;
  deleteParams: () => unknown[];
  executeCalls: () => number;
}

/** A fake db: the first execute is the ordered read; the next is the DELETE. */
function fakeDb(rows: readonly unknown[]): FakeDb {
  let selectDone = false;
  let deleteParams: unknown[] = [];
  const execute = vi.fn((query: SQL) => {
    if (!selectDone) {
      selectDone = true;
      return Promise.resolve({ rows });
    }
    deleteParams = new PgDialect().sqlToQuery(query).params;
    return Promise.resolve({ rows: [] });
  });
  return {
    db: { execute } as unknown as CatalogDb,
    deleteParams: () => deleteParams,
    executeCalls: () => execute.mock.calls.length,
  };
}

const ROWS = (seqs: number[], runs: (string | null)[]) =>
  seqs.map((seq, i) => ({ seq, work_id: "w", source: "anitabi", run_id: runs[i] }));

describe("Raw payload retention (AC5)", () => {
  it("defaults to keeping the newest two payloads per work/source", () => {
    expect(DEFAULT_KEEP_COUNT).toBe(2);
  });

  it("returns the count of rows pruned beyond the newest two", async () => {
    // 4 rows for one work/source; the two oldest (seq 1,2) are candidates.
    const fake = fakeDb(ROWS([4, 3, 2, 1], ["d-2", "d-2", "d-1", null]));
    const deleted = await cleanupRawHistory(fake.db, "d-2");
    expect(deleted).toBe(2);
    expect(fake.executeCalls()).toBe(2);
  });

  it("issues a single DELETE bound to the candidate seqs and the active run", async () => {
    const fake = fakeDb(ROWS([4, 3, 2, 1], ["d-2", "d-2", "d-1", null]));
    await cleanupRawHistory(fake.db, "d-2");
    const params = fake.deleteParams();
    expect(params).toEqual(expect.arrayContaining([1, 2, "d-2"]));
  });

  it("prunes nothing when every work/source group is within the keep bound", async () => {
    const fake = fakeDb(ROWS([2, 1], ["d-1", "d-1"]));
    const deleted = await cleanupRawHistory(fake.db, "d-1");
    expect(deleted).toBe(0);
    expect(fake.executeCalls()).toBe(1);
  });

  it("rejects a non-positive keep count", async () => {
    const fake = fakeDb(ROWS([2, 1], ["d-1", "d-1"]));
    return expect(cleanupRawHistory(fake.db, "d-1", 0)).rejects.toThrow(/keepCount/);
  });
});
