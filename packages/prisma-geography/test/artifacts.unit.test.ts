import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import migrationOperations from "../migrations/app/20260913T0425_create_geo_points/ops.json" with { type: "json" };
import contract from "../src/contract.json" with { type: "json" };

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationRoot = path.join(packageRoot, "migrations/app/20260913T0425_create_geo_points");

void test("the emitted contract retains the private extension and SRID", () => {
  const location = contract.storage.namespaces.public.entries.table.geo_points.columns.location;
  assert.equal(contract.extensions.geo.types.codecTypes.import.package, "@animichi/prisma-geography/codec-types");
  assert.deepEqual(location, {
    codecId: "pg/geography@1",
    nativeType: "geography",
    nullable: false,
    typeParams: { srid: 4326 },
  });
});

void test("the generated migration carries the authored geography column", async () => {
  const table = migrationOperations.find((operation) => operation.id === "table.geo_points");
  assert.match(table?.execute[0]?.sql ?? "", /"location" geography\(Point,4326\) NOT NULL/u);
  const source = await readFile(path.join(migrationRoot, "migration.ts"), "utf8");
  assert.match(source, /col\('location', 'geography\(Point,4326\)'/u);
});

void test("shipped source exposes no raw SQL escape hatch", async () => {
  const sourceRoot = path.join(packageRoot, "src/geography");
  const names = await readdir(sourceRoot);
  const sources = await Promise.all(names.filter((name) => name.endsWith(".ts")).map((name) => readFile(path.join(sourceRoot, name), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /createRawSql|RawSql|rawSql/u);
});
