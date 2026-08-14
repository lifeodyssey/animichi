import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  listDoneBangumiIds,
  listStaleBangumiIds,
  STALE_AFTER_SECONDS,
} from "../src/ingest/cron-queries";
import type { CatalogDb } from "../src/db/client";

/**
 * Behavior guard for the cron queries (S0-v2 D4 fix round). The worker pool has
 * no database, so the three staleness SEMANTICS are verified against real
 * Postgres in cron-queries.spike.test.ts. This suite pins the query-round trip
 * (bound params, single read) and the row-mapping behavior, so a regression in
 * the worker-facing contract still fails even when the spike suite is skipped
 * (no Neon).
 */

interface FakeDb {
  db: CatalogDb;
  calls: () => number;
  params: () => unknown[];
}

/** Extract the bound parameter VALUES of the executed statement (data, not SQL). */
function boundParams(query: SQL): unknown[] {
  return new PgDialect().sqlToQuery(query).params;
}

function fakeDb(rows: readonly unknown[]): FakeDb {
  let executed: SQL | undefined;
  const execute = vi.fn((query: SQL) => {
    executed = query;
    return Promise.resolve({ rows });
  });
  return {
    db: { execute } as unknown as CatalogDb,
    calls: () => execute.mock.calls.length,
    params: () => (executed ? boundParams(executed) : []),
  };
}

describe("listStaleBangumiIds", () => {
  it("round-trips one stale-read and binds the freshness floor and cap", async () => {
    const fake = fakeDb([{ work_id: "w-1" }]);

    await expect(listStaleBangumiIds(fake.db, 5)).resolves.toEqual(["w-1"]);

    expect(fake.calls()).toBe(1);
    expect(fake.params()).toContain(STALE_AFTER_SECONDS);
    expect(fake.params()).toContain(5);
  });

  it("returns work ids as strings and drops non-string rows", async () => {
    const fake = fakeDb([
      { work_id: "w-1" },
      { work_id: "w-2" },
      { work_id: 42 },
      { work_id: null },
      { work_id: "w-3" },
    ]);

    await expect(listStaleBangumiIds(fake.db, 5)).resolves.toEqual(["w-1", "w-2", "w-3"]);
    expect(fake.params()).toContain(STALE_AFTER_SECONDS);
    expect(fake.params()).toContain(5);
  });

  it("rejects a non-positive cap before issuing any SQL", async () => {
    const fake = fakeDb([]);

    await expect(listStaleBangumiIds(fake.db, 0)).rejects.toThrow("cron batch cap must be a positive integer");
    await expect(listStaleBangumiIds(fake.db, 2.5)).rejects.toThrow("cron batch cap must be a positive integer");
    expect(fake.calls()).toBe(0);
  });
});

describe("listDoneBangumiIds", () => {
  it("filters the checked-in ids to those with a done ingest_jobs row", async () => {
    const fake = fakeDb([{ work_id: "w-2" }]);

    await expect(listDoneBangumiIds(fake.db, ["w-1", "w-2", "w-3"])).resolves.toEqual(new Set(["w-2"]));

    expect(fake.calls()).toBe(1);
    expect(fake.params()).toEqual(expect.arrayContaining(["w-1", "w-2", "w-3"]));
  });

  it("returns an empty set without issuing SQL for an empty input", async () => {
    const fake = fakeDb([]);

    await expect(listDoneBangumiIds(fake.db, [])).resolves.toEqual(new Set());
    expect(fake.calls()).toBe(0);
  });
});
