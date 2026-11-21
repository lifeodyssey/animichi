/**
 * The schema a database cloned from the migrated template carries (#1769):
 * the chain's tables, its extensions, and prisma_contract.marker (Prisma's
 * applied-chain ledger) at the chain head. Shared by the template's
 * integration suites; not itself a test file.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { prismaChainHead } from "../../src/chain-identity.ts";

const CHAIN_TABLES = ["public.pi_sessions", "public.points", "prisma_contract.marker"] as const;
const CHAIN_EXTENSIONS = ["postgis", "pgcrypto", "pg_trgm", "vector"] as const;

export interface SchemaSnapshot {
  readonly tables: readonly string[];
  readonly extensions: readonly string[];
  readonly marker: readonly { space: string; core_hash: string }[];
}

export async function queryRows<Row extends pg.QueryResultRow>(dsn: string, statement: string, values: unknown[] = []): Promise<Row[]> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return (await client.query<Row>(statement, values)).rows;
  } finally {
    await client.end();
  }
}

async function listedTables(dsn: string): Promise<string[]> {
  const tables = await queryRows<{ name: string }>(dsn,
    `SELECT schemaname || '.' || tablename AS name FROM pg_tables
     WHERE schemaname IN ('public', 'prisma_contract') ORDER BY 1`);
  return tables.map((row) => row.name);
}

async function listedExtensions(dsn: string): Promise<string[]> {
  const extensions = await queryRows<{ extname: string }>(dsn,
    "SELECT extname FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY 1", [CHAIN_EXTENSIONS]);
  return extensions.map((row) => row.extname);
}

export async function schemaSnapshot(dsn: string): Promise<SchemaSnapshot> {
  const marker = await queryRows<{ space: string; core_hash: string }>(dsn,
    "SELECT space, core_hash FROM prisma_contract.marker ORDER BY space");
  return { tables: await listedTables(dsn), extensions: await listedExtensions(dsn), marker };
}

export async function assertChainSchema(dsn: string): Promise<void> {
  const tables = await listedTables(dsn);
  for (const table of CHAIN_TABLES) {
    assert.ok(tables.includes(table), `missing object: ${table}`);
  }
  const extensions = await listedExtensions(dsn);
  for (const extension of CHAIN_EXTENSIONS) {
    assert.ok(extensions.includes(extension), `missing object: extension ${extension}`);
  }
  assert.deepEqual((await schemaSnapshot(dsn)).marker, [{ space: "app", core_hash: prismaChainHead() }]);
}
