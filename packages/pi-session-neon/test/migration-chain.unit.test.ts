import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import contractJson from "../src/contract.json" with { type: "json" };

interface MigrationManifest {
  readonly from: string | null;
  readonly to: string;
}

interface MigrationOperation {
  readonly id: string;
  readonly execute?: readonly { readonly sql: string }[];
  readonly postcheck: readonly { readonly sql: string }[];
}

const migrationRoot = fileURLToPath(new URL("../migrations/app/", import.meta.url));
const baselineRoot = join(migrationRoot, "20260913T1711_data_plane_baseline");

async function baselineOperations(): Promise<readonly MigrationOperation[]> {
  return JSON.parse(await readFile(join(baselineRoot, "ops.json"), "utf8")) as MigrationOperation[];
}

function executedSql(operations: readonly MigrationOperation[]): string {
  return operations.flatMap(({ execute = [] }) => execute.map(({ sql }) => sql)).join("\n");
}

void test("the package owns one contiguous migration chain ending at the contract head", async () => {
  const names = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(names.length, 2);
  const manifests = await Promise.all(names.map(async (name) => {
    const path = join(migrationRoot, name, "migration.json");
    return JSON.parse(await readFile(path, "utf8")) as MigrationManifest;
  }));
  const first = manifests[0];
  const second = manifests[1];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.from, null);
  assert.match(first.to, /^[a-f0-9]{64}$/);
  assert.equal(second.from, first.to);
  assert.equal(second.to, contractJson.storage.storageHash);
});

void test("the baseline owns extension checks and no retired coordinate synchronizer", async () => {
  const operations = await baselineOperations();
  const extensions = operations.filter(({ id }) => id.startsWith("extension."));
  assert.deepEqual(extensions.map(({ id }) => id), ["extension.postgis", "extension.pgcrypto", "extension.pg_trgm", "extension.vector"]);
  assert.deepEqual(extensions.filter(({ postcheck }) => !postcheck.some(({ sql }) => sql.includes("extversion"))).map(({ id }) => id), []);
  assert.equal(executedSql(operations).includes("sync_points_coordinates"), false);
});

void test("the baseline installs and proves the two indexes schema verification cannot read", async () => {
  const operations = await baselineOperations();
  assert.equal(operations.some(({ id }) => id.startsWith("index.") && /trgm|work_source/.test(id)), false);
  const installed = operations.find(({ id }) => id === "data-plane-indexes");
  assert.ok(installed);
  const sql = [...(installed.execute ?? []), ...installed.postcheck].map((step) => step.sql).join("\n");
  assert.match(sql, /USING gin \(alias_normalized gin_trgm_ops\)/);
  assert.match(sql, /\(work_id, source, seq DESC\)/);
  assert.match(installed.postcheck[0]?.sql ?? "", /FROM pg_indexes[\s\S]*indexname = 'idx_location_aliases_trgm'/);
  assert.match(installed.postcheck[1]?.sql ?? "", /FROM pg_indexes[\s\S]*indexname = 'idx_raw_payload_history_work_source'/);
});
