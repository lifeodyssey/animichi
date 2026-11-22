/**
 * SUT: the timestamps a published catalog snapshot carries — `bangumi.updated_at` as a work's
 * `updatedAt` and `catalog_provenance.captured_at` as `capturedAt` — read by `exportCandidate`
 * through the real driver and the contract's `pg/timestamptz-string@1` codec.
 *
 * Since Prisma rc.21 that codec reads a `timestamptz` as the UTC instant in ISO 8601, with every
 * fractional digit the server sent; rc.9 passed the server's own text through. So the snapshot's
 * bytes and hashes changed once, with the release that brought rc.21. Nothing compares a hash
 * across snapshots: the import checks each object against its own manifest, and the publish
 * pointer and the GC key on snapshot ids. The import writes either form back as the same instant.
 */
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { exportCandidate, type ExportKind } from "../src/publish/candidate-export";
import { databaseDescribe, openPlanePrisma, planeDatabaseUrl, truncateCatalogPool, type PlanePrisma } from "./integration-db";

/** Written with a +09:00 offset and six fractional digits. */
const WRITTEN = "2026-09-10T09:00:00.123456+09:00";
/** The same instant as the codec reads it, whatever the session's time zone. */
const READ = "2026-09-10T00:00:00.123456Z";

let pool: pg.Pool;
let seam: PlanePrisma;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  seam = await openPlanePrisma();
}, 120_000);

afterAll(async () => {
  await seam.dispose();
  await pool.end();
});

/** One work and its provenance row, both stamped with {@link WRITTEN}. */
async function seedStampedWork(): Promise<void> {
  await truncateCatalogPool(pool);
  await pool.query("INSERT INTO bangumi (id, title, updated_at) VALUES ('ts1', 'Stamped', $1)", [WRITTEN]);
  await pool.query(
    "INSERT INTO catalog_provenance (scope, entity_id, work_id, source, captured_at) VALUES ('work', 'ts1', 'ts1', 'bangumi', $1)",
    [WRITTEN],
  );
}

/** One exported kind's rows, parsed back from the bytes the snapshot object carries. */
async function exportedRows(kind: ExportKind): Promise<readonly Record<string, unknown>[]> {
  const exported = await exportCandidate(seam.query, "snapshots/timestamps/data");
  const object = exported.objects.find((entry) => entry.kind === kind);
  if (object === undefined) throw new Error(`the export carries no ${kind} object`);
  return JSON.parse(new TextDecoder().decode(object.body)) as Record<string, unknown>[];
}

databaseDescribe("the snapshot export's timestamps", () => {
  it("carry a work's updated_at as its UTC instant in ISO 8601, every digit kept", async () => {
    await seedStampedWork();
    expect((await exportedRows("works")).map((row) => row.updatedAt)).toEqual([READ]);
  });

  it("carry a provenance row's captured_at as its UTC instant in ISO 8601, every digit kept", async () => {
    await seedStampedWork();
    expect((await exportedRows("provenance")).map((row) => row.capturedAt)).toEqual([READ]);
  });
});
