import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TABLES } from "../migrations/app/20260913T1711_data_plane_baseline/agent-tables.ts";
import { CATALOG_TABLES } from "../migrations/app/20260913T1711_data_plane_baseline/catalog-tables.ts";
import { NATIVE_TABLES } from "../migrations/app/20260913T1711_data_plane_baseline/native-tables.ts";
import { USER_TABLES } from "../migrations/app/20260913T1711_data_plane_baseline/user-tables.ts";
import contractJson from "../src/contract.json" with { type: "json" };

const NATIVE_TABLE_NAMES = [...NATIVE_TABLES, ...AGENT_TABLES].map(({ table }) => table);
const DATA_PLANE_TABLE_NAMES = [...CATALOG_TABLES, ...USER_TABLES].map(({ table }) => table);

interface DeclaredIndex {
  readonly name: string;
  readonly columns?: readonly string[];
  readonly type?: string;
}

interface DeclaredTable {
  readonly indexes?: readonly DeclaredIndex[];
}

/** The contract JSON is emitted IR, so one reader narrows its untyped root before the walk. */
function declaredTables(): Record<string, DeclaredTable> {
  const tables: unknown = contractJson.storage.namespaces.public.entries.table;
  if (tables === null || typeof tables !== "object") throw new Error("contract JSON has no public table namespace");
  return tables as Record<string, DeclaredTable>;
}

function declaredIndex(schema: Record<string, DeclaredTable>, table: string, name: string) {
  return (schema[table]?.indexes ?? []).find((index) => index.name === name);
}

void test("the native contract contains exactly the seven native and 19 data-plane tables", () => {
  assert.deepEqual(Object.keys(contractJson.roots).sort(), [...NATIVE_TABLE_NAMES, ...DATA_PLANE_TABLE_NAMES].sort());
});

void test("the data-plane target is one Prisma migration chain", () => {
  assert.equal(contractJson.storage.storageHash.length, 64);
  assert.equal(contractJson.extensions.geo.id, "geo");
});

void test("the operator-class and descending catalog indexes are declared as column lists", () => {
  const schema = declaredTables();
  assert.deepEqual(declaredIndex(schema, "location_aliases", "idx_location_aliases_trgm"),
    { columns: ["alias_normalized"], name: "idx_location_aliases_trgm", type: "gin", unique: false });
  assert.deepEqual(declaredIndex(schema, "raw_payload_history", "idx_raw_payload_history_work_source"),
    { columns: ["work_id", "source", "seq"], name: "idx_raw_payload_history_work_source", unique: false });
});
