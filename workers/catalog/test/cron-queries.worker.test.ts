import { describe, expect, it, vi } from "vitest";
import { Param, SQL } from "drizzle-orm";
import {
  listDoneBangumiIds,
  listStaleBangumiIds,
  STALE_AFTER_SECONDS,
} from "../src/ingest/cron-queries";
import type { CatalogDb } from "../src/db/client";

/**
 * SQL-shape guard for the cron queries (S0-v2 D4 fix round).
 *
 * The worker pool has no database, so the three staleness SEMANTICS are
 * verified against real Postgres in cron-queries.spike.test.ts. This suite
 * pins the SQL SHAPE here so a regression to the old `MAX(fetched_at)` /
 * UNION-ALL freshness fails even when the spike suite is skipped (no Neon).
 */

interface FakeDb {
  db: CatalogDb;
  sqlText: () => string;
}

/** A drizzle template literal's raw string segment (chunk value arrays). */
function isStringSegment(chunk: unknown): chunk is { value: readonly string[] } {
  if (chunk === null || typeof chunk !== "object") return false;
  if (!("value" in chunk) || !Array.isArray(chunk.value)) return false;
  return chunk.value.every((part) => typeof part === "string");
}

/** Render one chunk as query text; nested SQL recurses, primitive values inline. */
function chunkText(chunk: unknown): string | undefined {
  if (chunk instanceof SQL) return renderQuery(chunk);
  if (chunk instanceof Param || typeof chunk === "string"
    || typeof chunk === "number" || typeof chunk === "boolean") {
    return String(chunk instanceof Param ? chunk.value : chunk);
  }
  if (isStringSegment(chunk)) return chunk.value.join("");
  return undefined;
}

/** Flatten a drizzle SQL value into its raw query text (values inline as text). */
function renderQuery(query: SQL): string {
  return query.queryChunks
    .map((chunk) => chunkText(chunk))
    .filter((text): text is string => text !== undefined)
    .join("");
}

function fakeDb(rows: readonly unknown[]): FakeDb {
  let executed: SQL | undefined;
  const execute = vi.fn((query: SQL) => {
    executed = query;
    return Promise.resolve({ rows });
  });
  return {
    db: { execute } as unknown as CatalogDb,
    sqlText: () => renderQuery(executed ?? new SQL([])),
  };
}

describe("listStaleBangumiIds SQL shape", () => {
  it("orders by the WEAKEST fetch across both sources, treating a missing row as infinitely old", async () => {
    const fake = fakeDb([{ work_id: "w-1" }]);

    await listStaleBangumiIds(fake.db, 5);

    const sqlText = fake.sqlText();
    expect(sqlText).toContain("FULL OUTER JOIN");
    expect(sqlText).toContain("LEAST(");
    expect(sqlText).toContain("COALESCE(");
    expect(sqlText).toContain("-infinity");
    expect(sqlText).not.toContain("MAX(fetched_at)");
    expect(sqlText).not.toContain("UNION");
  });

  it("floors freshness at the TTL constant and skips works behind a live negative cache", async () => {
    const fake = fakeDb([]);

    await listStaleBangumiIds(fake.db, 5);

    const sqlText = fake.sqlText();
    expect(sqlText).toContain("make_interval");
    expect(sqlText).toContain("make_interval(secs => " + String(STALE_AFTER_SECONDS) + ")");
    expect(sqlText).toContain("negative_cached_until > NOW()");
    expect(sqlText).toContain("NOT EXISTS");
    expect(sqlText).toContain("LIMIT 5");
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
  });

  it("rejects a non-positive cap before issuing any SQL", async () => {
    const fake = fakeDb([]);

    await expect(listStaleBangumiIds(fake.db, 0)).rejects.toThrow("cron batch cap must be a positive integer");
    await expect(listStaleBangumiIds(fake.db, 2.5)).rejects.toThrow("cron batch cap must be a positive integer");
    expect(fake.sqlText()).toBe("");
  });
});

describe("listDoneBangumiIds SQL shape", () => {
  it("filters the checked-in ids to those with a done ingest_jobs row", async () => {
    const fake = fakeDb([{ work_id: "w-2" }]);

    await expect(listDoneBangumiIds(fake.db, ["w-1", "w-2", "w-3"])).resolves.toEqual(new Set(["w-2"]));

    const sqlText = fake.sqlText();
    expect(sqlText).toContain("FROM ingest_jobs");
    expect(sqlText).toContain("status = 'done'");
    expect(sqlText).toContain("IN (");
  });

  it("returns an empty set without issuing SQL for an empty input", async () => {
    const fake = fakeDb([]);

    await expect(listDoneBangumiIds(fake.db, [])).resolves.toEqual(new Set());
    expect(fake.sqlText()).toBe("");
  });
});
