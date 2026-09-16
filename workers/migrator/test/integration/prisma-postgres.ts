import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { expect, vi } from "vitest";
import { ChainApplyTurn, clusterAdminDsn, createCleanDatabase, dropCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";
import { LEDGER_SQL } from "../../src/http-apply";
import { openOwnedDatabase, useOwnedDatabase, type OwnedDatabase } from "./owned-database";

interface Query { query: string; params: unknown[] }
interface Batch { queries: Query[] }

const EXTENSIONS = ["postgis", "pgcrypto", "pg_trgm", "vector"] as const;
const LEDGER_COLUMNS = ["version", "description", "type", "applied", "total", "executed_at",
  "execution_time", "error", "error_stmt", "hash", "partial_hashes", "operator_version"] as const;
/** The chain the migrator still serves until #1634: the transition handshake compares the live
 * Atlas ledger against this chain's prefix, so a ledger source has to be a real apply of it. */
const ATLAS_CHAIN = new URL("../../../../migrations/neon/", import.meta.url);
const OUTPUT_CEILING_BYTES = 10 * 1024 * 1024;

async function withClient<T>(dsn: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(dsn);
  await client.connect();
  try { return await run(client); }
  finally { await client.end(); }
}

/** Apply the committed `migrations/neon` chain to `dsn`. */
async function applyAtlasChain(dsn: string): Promise<void> {
  await promisify(execFile)(process.env.ATLAS_BIN ?? "atlas", ["migrate", "apply",
    "--dir", ATLAS_CHAIN.href, "--url", dsn, "--revisions-schema", "public"],
    { env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" }, maxBuffer: OUTPUT_CEILING_BYTES });
}

/** The database a target's ledger rows come from, owned by this fixture.
 *
 * It used to be the shared plane's own database, which `startTestPostgres` had
 * applied the Atlas chain to. Since #1625 that database is migrated by the
 * Prisma chain, and a fixture may not read one chain's artifacts out of another
 * chain's database — nor apply Atlas over a live Prisma marker. So the fixture
 * applies the committed chain to a database of its own: `stop()` gives it back,
 * and `useOwnedDatabase` gives it back when the apply fails.
 *
 * The apply holds the cluster turn (#1663) like every other apply on this
 * cluster: the committed chain's role block is cluster-global and
 * check-then-create, so it must not run beside the plane's own apply. */
export function openAtlasLedger(baseDsn: string): Promise<OwnedDatabase> {
  return openOwnedDatabase(baseDsn, "atlas_ledger").then((owned) => useOwnedDatabase(owned, async () => {
    await new ChainApplyTurn(clusterAdminDsn(baseDsn)).hold(() => applyAtlasChain(owned.dsn));
    return owned;
  }));
}

/** The extensions are already present in the database Neon hands the non-superuser migrator; the
 * chain's `IF NOT EXISTS` then only proves their versions, which is what lets a role without
 * superuser reach the end of the baseline. */
async function installExtensions(client: pg.Client): Promise<void> {
  for (const extension of EXTENSIONS) await client.query(`CREATE EXTENSION "${extension}"`);
}

/** The ledger is the read-only record of what Atlas applied; its rows never bring Atlas DDL. */
async function copyLedger(ledgerDsn: string, target: pg.Client): Promise<void> {
  const columns = LEDGER_COLUMNS.join(", ");
  const rows = await withClient(ledgerDsn, async (source) =>
    (await source.query<Record<string, unknown>>(`SELECT ${columns} FROM public.atlas_schema_revisions ORDER BY version`)).rows);
  await target.query(LEDGER_SQL);
  await target.query(`INSERT INTO public.atlas_schema_revisions (${columns})
    SELECT ${columns} FROM jsonb_populate_recordset(null::public.atlas_schema_revisions, $1)`, [JSON.stringify(rows)]);
}

/** The transition handshake's migration target: a pristine `template1` database that carries only
 * the Atlas ledger rows — no Atlas DDL — so exactly one chain owns its objects. `ledgerDsn` reaches
 * the ledger source `openAtlasLedger` owns, and is also the admin base every database here is
 * created through. The target is named per call and dropped by `stop()`, like every database
 * created on the shared container (#1663). */
export interface PrismaMigrationTarget {
  readonly dsn: string;
  stop(): Promise<void>;
}

export async function openPrismaMigrationTarget(ledgerDsn: string, suite: string): Promise<PrismaMigrationTarget> {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(ledgerDsn, name);
  const target: PrismaMigrationTarget = { dsn, stop: () => dropCleanDatabase(ledgerDsn, name) };
  return useOwnedDatabase(target, async () => {
    await withClient(dsn, async (client) => {
      await installExtensions(client);
      await copyLedger(ledgerDsn, client);
    });
    return target;
  });
}

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
