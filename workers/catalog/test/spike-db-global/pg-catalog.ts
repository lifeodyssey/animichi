/** A node-postgres-backed CatalogDb for the hermetic Docker Postgres arm.
 *
 * Production builds CatalogDb with the neon-http driver (Cloudflare Worker); a
 * plain Postgres container speaks no neon HTTP, so the spike suite drives the
 * same CatalogDb seam (execute / select / batch) through pg. db.batch — the
 * atomically-swapped publish/import primitive — is emulated on the pool as one
 * BEGIN/COMMIT transaction, keeping the flip-then-insert ordering and the
 * all-or-nothing semantics the neon-http batch() documents. */
import { type SQL, QueryPromise } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";
import type { CatalogDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";

/** The row shape every execute()/batch() result resolves to (mirrors pg rows). */
interface RowsResult { rows: unknown[] }

/** A single compiled statement. Await it to run it exactly once, or hand it to
 * batch(), which unwinds .query into one shared transaction. It extends
 * drizzle's QueryPromise (the same thenable base as the neon driver's PgRaw) so
 * awaiting triggers run() lazily; DeferredQuery declares no then itself. */
class DeferredQuery extends QueryPromise<RowsResult> {
  readonly query: SQL | { getSQL(): SQL };
  private readonly runner: () => Promise<RowsResult>;
  private settled: Promise<RowsResult> | null = null;

  constructor(query: SQL | { getSQL(): SQL }, runner: () => Promise<RowsResult>) {
    super();
    this.query = query;
    this.runner = runner;
  }

  /** Run the statement; repeat calls await the same settled result. */
  run(): Promise<RowsResult> {
    return (this.settled ??= this.runner());
  }

  /** QueryPromise hook: awaited DeferredQuerys execute through run(). */
  execute(): Promise<RowsResult> {
    return this.run();
  }
}

function asSql(query: SQL | { getSQL(): SQL }): SQL {
  return query.getSQL();
}

async function runOne(pool: pg.Pool, dialect: PgDialect, query: SQL | { getSQL(): SQL }): Promise<RowsResult> {
  const compiled = dialect.sqlToQuery(asSql(query));
  const result = await pool.query(compiled.sql, compiled.params);
  return { rows: result.rows };
}

async function runBatch(pool: pg.Pool, dialect: PgDialect, queries: DeferredQuery[]): Promise<RowsResult[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results: RowsResult[] = [];
    for (const item of queries) {
      const compiled = dialect.sqlToQuery(asSql(item.query));
      const result = await client.query(compiled.sql, compiled.params);
      results.push({ rows: result.rows });
    }
    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Build a CatalogDb over a pg.Pool for the Docker Postgres arm. */
export function makePgCatalog(pool: pg.Pool): CatalogDb {
  const inner = drizzle(pool, { schema });
  const dialect = new PgDialect();
  const db = {
    execute: (query: SQL | { getSQL(): SQL }): DeferredQuery =>
      new DeferredQuery(query, () => runOne(pool, dialect, query)),
    batch: (queries: DeferredQuery[]): Promise<RowsResult[]> => runBatch(pool, dialect, queries),
    select: inner.select.bind(inner),
  } as unknown as CatalogDb;
  return db;
}
