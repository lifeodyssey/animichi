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

function queryText(statement: SQL): string {
  return dialect.sqlToQuery(statement).sql.replaceAll(/\s+/g, " ").trim();
}

function queryParams(statement: SQL): unknown[] {
  return dialect.sqlToQuery(statement).params;
}

function queryResult(statement: SQL): { rows: unknown[] } {
  const text = queryText(statement);
  if (text.includes("FROM raw_bangumi")) return { rows: [{ payload: RAW_BANGUMI }] };
  if (text.includes("FROM raw_anitabi")) return { rows: [{ payload: RAW_ANITABI }] };
  return { rows: [] };
}

function capturedQuery(statement: SQL): CapturedQuery {
  return Object.assign(Promise.resolve(queryResult(statement)), { statement });
}

function fakeDb(version: number): {
  db: CatalogDb;
  batch: ReturnType<typeof vi.fn<(queries: readonly CapturedQuery[]) => Promise<{ rows: unknown[] }[]>>>;
} {
  const execute = vi.fn(capturedQuery);
  const batch = vi.fn((queries: readonly CapturedQuery[]) =>
    Promise.resolve(queries.map((_query, index) =>
      index === queries.length - 1 ? { rows: [{ version }] } : { rows: [] })),
  );
  return { db: { execute, batch } as unknown as CatalogDb, batch };
}

function submittedTexts(
  batch: ReturnType<typeof vi.fn<(queries: readonly CapturedQuery[]) => Promise<{ rows: unknown[] }[]>>>,
): string[] {
  return (batch.mock.calls[0]?.[0] ?? []).map((query) => queryText(query.statement));
}

function statementAt(queries: readonly CapturedQuery[], index: number): SQL {
  const query = queries[index];
  if (!query) throw new Error(`batch query ${String(index)} was not submitted`);
  return query.statement;
}

it("publishes with one ordered neon-http batch", async () => {
  const { db, batch } = fakeDb(7);
  await expect(publishVersion(db, "batch-work")).resolves.toBe(7);
  expect(batch).toHaveBeenCalledTimes(1);
  const texts = submittedTexts(batch);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toMatch(/^UPDATE cluster_version SET is_current = FALSE/);
  expect(texts[1]).toMatch(/^INSERT INTO cluster_version .* SELECT .*MAX\(version\).* RETURNING version$/);
});

it("submits all enrich writes in one ordered neon-http batch", async () => {
  const { db, batch } = fakeDb(11);
  await expect(enrichWork(db, "batch-work")).resolves.toEqual({ version: 11, pointCount: 2 });
  expect(batch).toHaveBeenCalledTimes(1);
  const texts = submittedTexts(batch);
  expect(texts).toHaveLength(5);
  expect(texts.map((text) => text.split(" ").slice(0, 3).join(" "))).toEqual([
    "INSERT INTO bangumi", "INSERT INTO points", "INSERT INTO aliases",
    "UPDATE cluster_version SET", "INSERT INTO cluster_version",
  ]);
  const submitted = batch.mock.calls[0]?.[0] ?? [];
  expect(queryParams(statementAt(submitted, 1))).toEqual(
    expect.arrayContaining(["point-1", "point-2"]),
  );
  expect(queryParams(statementAt(submitted, 2))).toEqual(
    expect.arrayContaining(["Batch Anime", "批次动画"]),
  );
  expect(texts[4]).toMatch(/SELECT .*MAX\(version\).* RETURNING version$/);
});
