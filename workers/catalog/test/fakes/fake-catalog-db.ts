/**
 * A fake CatalogDb whose execute() returns per-table rows keyed by the table
 * named in the statement's usedTables (exposed by the Drizzle builder), so
 * candidate export + snapshot orchestration are testable in the worker pool.
 *
 * `.batch()` mirrors Neon's server-side batch contract used by
 * `publishVersion` (src/publish/versioning.ts) and `importBatch`
 * (src/import/switch.ts): ONE transaction, all-or-nothing. `db.execute(stmt)`
 * is the LAZY build step here (no computation happens yet — it just captures
 * the statement); the computation only runs when the result is consumed,
 * either by awaiting it standalone (index 0) or by `db.batch([...])`
 * iterating its array in order. A batch failure at index N therefore means:
 * every statement before N already "ran" (its rows/side effect were
 * computed), N throws, and nothing after N ever runs — the `for` loop stops
 * and the whole `batch()` call rejects, matching a real mid-transaction abort
 * from the caller's point of view (the caller never observes a partial
 * results array).
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { CatalogDb } from "../../src/db/client";

/** One injected failure. Matches when EVERY given condition holds: `atIndex`
 * is the 0-based position within a `db.batch([...])` call (a bare
 * `db.execute()` await is always position 0); `sqlIncludes` is a substring of
 * the statement's rendered SQL (via PgDialect, same renderer the repo's other
 * fakes use — see workers/catalog/test/run-store.worker.test.ts). Omitting a
 * condition means "any". */
export interface FakeCatalogDbError {
  readonly atIndex?: number;
  readonly sqlIncludes?: string;
  readonly error: Error;
}

export interface FakeCatalogDbOptions {
  readonly errors?: readonly FakeCatalogDbError[];
}

interface FakeQueryResult { readonly rows: unknown[] }

/** A lazy, thenable statement: `await`-able standalone (index 0), or
 * consumable by `.batch()` at its real array position. */
interface FakeQuery extends PromiseLike<FakeQueryResult> {
  readonly statement: SQL;
}

const dialect = new PgDialect();

function toSql(raw: SQL | { getSQL(): SQL }): SQL {
  return "getSQL" in raw ? raw.getSQL() : raw;
}

function renderedSql(statement: SQL): string {
  return dialect.sqlToQuery(statement).sql;
}

function tableRows(rowsByTable: Record<string, readonly unknown[]>, statement: SQL): FakeQueryResult {
  const used: unknown = (statement as { usedTables?: unknown }).usedTables;
  const table: unknown = Array.isArray(used) ? used[0] : undefined;
  const rows = typeof table === "string" ? rowsByTable[table] : undefined;
  return { rows: [...(rows ?? [])] };
}

/** The first injected error whose conditions all match this statement/index. */
function matchingError(
  errors: readonly FakeCatalogDbError[], statement: SQL, index: number,
): Error | undefined {
  return errors.find((spec) =>
    (spec.atIndex === undefined || spec.atIndex === index)
    && (spec.sqlIncludes === undefined || renderedSql(statement).includes(spec.sqlIncludes)))?.error;
}

/** Narrow a catch-clause `unknown` to an Error, since `resolve()` only ever
 * throws the caller's injected `Error` — this is defensive, not expected. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function makeFakeQuery(
  statement: SQL, resolve: (stmt: SQL, index: number) => FakeQueryResult,
): FakeQuery {
  return {
    statement,
    then(onfulfilled, onrejected) {
      let settled: PromiseLike<FakeQueryResult>;
      try {
        settled = Promise.resolve(resolve(statement, 0));
      } catch (error) {
        settled = Promise.reject(asError(error));
      }
      return settled.then(onfulfilled, onrejected);
    },
  };
}

/** Build a fake CatalogDb returning rowsByTable[table] for each select/insert
 * RETURNING, with an optional error-injection channel and a `.batch()` that
 * mirrors Neon's one-transaction all-or-nothing contract (see module docs). */
export function fakeCatalogDb(
  rowsByTable: Record<string, readonly unknown[]>,
  options: FakeCatalogDbOptions = {},
): CatalogDb {
  const errors = options.errors ?? [];
  const resolve = (statement: SQL, index: number): FakeQueryResult => {
    const failure = matchingError(errors, statement, index);
    if (failure !== undefined) throw failure;
    return tableRows(rowsByTable, statement);
  };
  const db = {
    execute: (raw: SQL | { getSQL(): SQL }) => makeFakeQuery(toSql(raw), resolve),
    batch: (queries: readonly FakeQuery[]): Promise<FakeQueryResult[]> => {
      try {
        const results: FakeQueryResult[] = [];
        for (const [index, query] of queries.entries()) {
          results.push(resolve(query.statement, index));
        }
        return Promise.resolve(results);
      } catch (error) {
        return Promise.reject(asError(error));
      }
    },
  };
  return db as unknown as CatalogDb;
}
