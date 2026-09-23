import pg from "pg";
import { expect, vi } from "vitest";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";
import { useOwnedDatabase } from "./owned-database";

const EXTENSIONS = ["postgis", "pgcrypto", "pg_trgm", "vector"] as const;

/** The extensions are already present in the database Neon hands the non-superuser migrator; the
 * chain's `IF NOT EXISTS` then only proves their versions, which is what lets a role without
 * superuser reach the end of the baseline. */
async function installExtensions(dsn: string): Promise<void> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    for (const extension of EXTENSIONS) await client.query(`CREATE EXTENSION "${extension}"`);
  } finally { await client.end(); }
}

/** The migration target: a pristine `template0` database carrying the extensions Neon preinstalls
 * and nothing else, so the sealed graph is the only owner of every object in it. Named per call
 * and dropped by `stop()`, like every database created on the shared container (#1663). */
export interface PrismaMigrationTarget {
  readonly dsn: string;
  stop(): Promise<void>;
}

export async function openPrismaMigrationTarget(adminDsn: string, suite: string): Promise<PrismaMigrationTarget> {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(adminDsn, name);
  const target: PrismaMigrationTarget = { dsn, stop: () => dropCleanDatabase(adminDsn, name) };
  return useOwnedDatabase(target, async () => {
    await installExtensions(dsn);
    return target;
  });
}

interface Query { query: string; params: unknown[] }
interface Batch { queries: Query[] }

async function query(client: pg.Client, statement: Query) {
  return client.query<unknown[]>({ text: statement.query, values: statement.params, rowMode: "array" });
}

async function batch(client: pg.Client, statements: Batch, headers: Headers) {
  const readOnly = headers.get("Neon-Batch-Read-Only") === "true" ? " READ ONLY" : "";
  await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly}`);
  const results = [];
  for (const statement of statements.queries) results.push(await query(client, statement));
  await client.query("COMMIT");
  return { results };
}

/** Replace only Neon HTTP transport; pg executes the SDK's payload unchanged. */
export function servePrismaPostgres(dsn: string): void {
  vi.stubGlobal("fetch", async (_input: unknown, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    expect(headers.get("Neon-Connection-String")).toBe(dsn);
    return postgresHttp(dsn, headers, options?.body as string);
  });
}

export async function postgresHttp(dsn: string, headers: Headers, body: string): Promise<Response> {
  const statement = JSON.parse(body) as Query | Batch;
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    const result = "queries" in statement ? await batch(client, statement, headers) : await query(client, statement);
    return Response.json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof pg.DatabaseError) return Response.json({ code: error.code, message: error.message }, { status: 400 });
    throw error;
  } finally { await client.end(); }
}
