import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { enrichWork } from "../src/enrich/enrich";
import { publishVersion } from "../src/publish/versioning";

interface CapturedQuery extends Promise<{ rows: unknown[] }> {
  statement: SQL;
}

const RAW_BANGUMI = { name: "Batch Anime", name_cn: "批次动画" };
const RAW_ANITABI = [
  { id: "point-1", name: "Batch Place", geo: [35, 139] },
  { id: "point-2", name: "Second Place", geo: [36, 140] },
];
const dialect = new PgDialect();

/** Bound parameter values for one submitted statement (asserted as data, not SQL). */
function queryParams(statement: SQL): unknown[] {
  return dialect.sqlToQuery(statement).params;
}

/** Raw-zone read results, resolved in the order enrichWork requests them. */
function rawRead(reads: number): { rows: unknown[] } {
  if (reads === 0) return { rows: [{ payload: RAW_BANGUMI }] };
  if (reads === 1) return { rows: [{ payload: RAW_ANITABI }] };
  return { rows: [] };
}

function capturedQuery(statement: SQL, reads: number): CapturedQuery {
  return Object.assign(Promise.resolve(rawRead(reads)), { statement });
}

type BatchMock = ReturnType<typeof vi.fn<(queries: readonly CapturedQuery[]) => Promise<{ rows: unknown[] }[]>>>;

function fakeDb(version: number): { db: CatalogDb; batch: BatchMock } {
  let reads = 0;
  const execute = vi.fn((statement: SQL) => capturedQuery(statement, reads++));
  const batch = vi.fn((queries: readonly CapturedQuery[]) =>
    Promise.resolve(queries.map((_query, index) =>
      index === queries.length - 1 ? { rows: [{ version }] } : { rows: [] })),
  );
  return { db: { execute, batch } as unknown as CatalogDb, batch };
}

function statementAt(queries: readonly CapturedQuery[], index: number): SQL {
  const query = queries[index];
  if (!query) throw new Error("batch query " + String(index) + " was not submitted");
  return query.statement;
}

it("publishes with one ordered neon-http batch", async () => {
  const { db, batch } = fakeDb(7);
  await expect(publishVersion(db, "batch-work")).resolves.toBe(7);
  expect(batch).toHaveBeenCalledTimes(1);
  const submitted = batch.mock.calls[0]?.[0] ?? [];
  expect(submitted).toHaveLength(2);
});

it("submits all enrich writes in one ordered neon-http batch", async () => {
  const { db, batch } = fakeDb(11);
  await expect(enrichWork(db, "batch-work")).resolves.toEqual({ version: 11, pointCount: 2 });
  expect(batch).toHaveBeenCalledTimes(1);
  const submitted = batch.mock.calls[0]?.[0] ?? [];
  expect(submitted).toHaveLength(5);
  expect(queryParams(statementAt(submitted, 1))).toEqual(
    expect.arrayContaining(["point-1", "point-2"]),
  );
  expect(queryParams(statementAt(submitted, 2))).toEqual(
    expect.arrayContaining(["Batch Anime", "批次动画"]),
  );
});
