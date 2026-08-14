/**
 * A fake CatalogDb whose execute() returns per-table rows keyed by the table
 * named in the statement's usedTables (exposed by the Drizzle builder), so
 * candidate export + snapshot orchestration are testable in the worker pool.
 */
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../../src/db/client";

/** Build a fake CatalogDb returning rowsByTable[table] for each select. */
export function fakeCatalogDb(rowsByTable: Record<string, readonly unknown[]>): CatalogDb {
  const db = {
    execute: (statement: SQL | { getSQL(): SQL }) => {
      const query = "getSQL" in statement ? statement.getSQL() : statement;
      const used: unknown = (query as { usedTables?: unknown }).usedTables;
      const table: unknown = Array.isArray(used) ? used[0] : undefined;
      const rows = typeof table === "string" ? rowsByTable[table] : undefined;
      return Promise.resolve({ rows: [...(rows ?? [])] });
    },
  };
  return db as unknown as CatalogDb;
}
