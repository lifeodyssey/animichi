import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { appendRawHistory, cleanupRawHistory, DEFAULT_KEEP_COUNT } from "../src/ingest/raw_history";
import type { CatalogDb } from "../src/db/client";

interface FakeDb {
  db: CatalogDb;
  deleteParams: () => unknown[];
  executeCalls: () => number;
}

/** A fake db: the first execute is the ordered read; the next is the DELETE.RETURNING. */
function fakeDb(rows: readonly unknown[]): FakeDb {
  let selectDone = false;
  let deleteRows: unknown[] = [];
  let deleteParams: unknown[] = [];
  const execute = vi.fn((query: SQL) => {
    if (!selectDone) {
      selectDone = true;
      return Promise.resolve({ rows });
    }
    const params = new PgDialect().sqlToQuery(query).params;
    deleteParams = params;
    deleteRows = deletedRows(rows, params);
    return Promise.resolve({ rows: deleteRows });
  });
  return {
    db: { execute } as unknown as CatalogDb,
    deleteParams: () => deleteParams,
    executeCalls: () => execute.mock.calls.length,
  };
}

/** The rows the DELETE.RETURNING would delete: candidates whose run differs from active. */
function deletedRows(rows: readonly unknown[], params: unknown[]): unknown[] {
  const activeRun = params[params.length - 1] as string | null;
  const candidates = new Set(params.slice(0, -1) as number[]);
  return rows.filter((row) => {
    const record = row as Record<string, unknown>;
    return candidates.has(record.seq as number) && record.run_id !== activeRun;
  });
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

  it("derives the count from rows actually deleted via DELETE.RETURNING", async () => {
    // seq 1,2 are candidates but belong to the active run, so nothing is deleted.
    const fake = fakeDb(ROWS([4, 3, 2, 1], ["d-2", "d-2", "d-2", "d-2"]));
    const deleted = await cleanupRawHistory(fake.db, "d-2");
    expect(deleted).toBe(0);
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

describe("Raw payload serialization (thread 8)", () => {
  it("binds the payload as a single-encoded JSON document, not a string of a string", async () => {
    let captured: unknown[] = [];
    const execute = vi.fn((query: SQL) => {
      captured = new PgDialect().sqlToQuery(query).params;
      return Promise.resolve({ rows: [] });
    });
    const db = { execute } as unknown as CatalogDb;
    const payload = { id: 1, name: "Sora" };
    await appendRawHistory(db, { workId: "w-1", source: "bangumi", payload });
    const bound = captured.find((p) => typeof p === "string" && p.includes("Sora"));
    expect(JSON.parse(bound as string)).toEqual(payload);
  });
});
