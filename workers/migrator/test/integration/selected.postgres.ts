import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { Response as WorkerResponse, type Request as WorkerRequest } from "miniflare";
import { openOwnedDatabase, useOwnedDatabase, type OwnedDatabase } from "./owned-database";

const CHAIN = new URL("../fixtures/preflight-three-chain/", import.meta.url);
interface Query { query: string; params: string[] }
interface Batch { queries: Query[] }
export interface SqlCapture { queries: Query[]; readOnly: string | null; isolation: string | null }

export async function applyNativeFixture(dsn: string, amount: string[] = []): Promise<void> {
  await promisify(execFile)(process.env.ATLAS_BIN ?? "atlas", ["migrate", "apply", "--dir", CHAIN.href,
    "--url", dsn, "--revisions-schema", "public", ...amount], { env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" } });
}

/** A database of this case's own, plus the drop that gives it back to the
 * shared server (#1663) — the reason the name is per call, not a constant. */
export async function selectedDatabase(baseDsn: string) {
  const owned = await openOwnedDatabase(baseDsn, "selected");
  return useOwnedDatabase(owned, () => applySelectedFixture(owned));
}

/** The chain's first migration, applied to the case's own database. */
async function applySelectedFixture(owned: OwnedDatabase): Promise<OwnedDatabase> {
  await applyNativeFixture(owned.dsn, ["1"]);
  return owned;
}

async function queriesOn(client: pg.Client, queries: Query[]): Promise<pg.QueryResult<unknown[]>[]> {
  const results = [];
  for (const { query, params } of queries) {
    results.push(await client.query<unknown[]>({ text: query, values: params, rowMode: "array" }));
  }
  return results;
}

async function batchOn(client: pg.Client, capture: SqlCapture): Promise<pg.QueryResult<unknown[]>[]> {
  const mode = capture.readOnly === "true" ? " ISOLATION LEVEL REPEATABLE READ READ ONLY" : "";
  await client.query(`BEGIN${mode}`);
  const results = await queriesOn(client, capture.queries);
  await client.query("COMMIT");
  return results;
}

async function execute(dsn: string, body: Query | Batch, capture: SqlCapture): Promise<WorkerResponse> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    const results = "queries" in body ? await batchOn(client, capture) : await queriesOn(client, capture.queries);
    return WorkerResponse.json("queries" in body ? { results } : results[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof pg.DatabaseError) return WorkerResponse.json({ code: error.code, message: error.message }, { status: 400 });
    throw error;
  } finally {
    await client.end();
  }
}

/** Native Neon HTTP requests reach disposable PostgreSQL; no production transport is replaced. */
export function selectedPostgresTransport(dsn: string, captures: SqlCapture[]) {
  return async (request: WorkerRequest): Promise<WorkerResponse> => {
    const body = await request.json() as Query | Batch;
    const capture = { queries: "queries" in body ? body.queries : [body],
      readOnly: request.headers.get("Neon-Batch-Read-Only"), isolation: request.headers.get("Neon-Batch-Isolation-Level") };
    captures.push(capture);
    return execute(dsn, body, capture);
  };
}
