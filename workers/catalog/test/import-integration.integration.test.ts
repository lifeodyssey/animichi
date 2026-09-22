/**
 * Staging snapshot import integration (issue #1016, AC3/AC4/AC6).
 *
 * Runs the real import pipeline (importSnapshot -> neonImportActivation's
 * one-transaction atomic switch) against the Prisma-plane database the
 * committed chain built:
 *   AC3: output staged from a real production-shaped export+manifest.  AC4: an
 *   invalid import performs ZERO activation (staging tables untouched); a valid
 *   import atomically replaces the staging Catalog in one transaction.  AC6:
 *   after import, staging holds the public Catalog and NO user-domain records.
 *
 * Export and import now run on the SAME plane (#1633). They always had to share
 * a database — a candidate read from one shape into another would not be the
 * import this file is about — and the shape they share is the one every real
 * environment has, now that the import writes the plane's columns rather than
 * the pre-Prisma set.
 *
 * `keeps every exported column across the round trip` is what pins the pairing
 * in `src/import/snapshot-rows.ts`: the export projects the snapshot's own
 * camelCase keys, the import reads them back as this plane's columns, and only
 * a value assertion can tell a correct pairing from a silently dropped column.
 */
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { exportCandidate } from "../src/publish/candidate-export";
import { buildManifest } from "../src/publish/manifest";
import { importSnapshot } from "../src/import/import-snapshot";
import { fakeSnapshotSource } from "./fakes/fake-snapshot-source";
import {
  databaseDescribe,
  openPlanePrisma,
  planeDatabaseUrl,
  truncateCatalogPool,
  type PlanePrisma,
} from "./integration-db";

let pool: pg.Pool;
let query: CatalogPrisma;
let seam: PlanePrisma;

/** The production set the export reads: two works, one point, one provenance row. */
async function seedProductionSet(): Promise<void> {
  await pool.query(
    "INSERT INTO bangumi (id, title, title_cn) VALUES ('prod1', 'Lucky Star', '幸運星'), ('prod2', 'Slow Loop', NULL)",
  );
  await pool.query(
    "INSERT INTO points (id, bangumi_id, name, episode, time_seconds, location)"
    + " VALUES ('pp1', 'prod1', 'gate', 3, 42, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)",
    [139.6, 36.1],
  );
  await pool.query(
    "INSERT INTO catalog_provenance (scope, entity_id, work_id, source, attribution)"
    + " VALUES ('work', 'prod1', 'prod1', 'bangumi', $1)", [JSON.stringify({ by: "bangumi" })],
  );
}

/** The rows the import must replace: a different work, a different point. */
async function seedStagingBaseline(): Promise<void> {
  await pool.query("INSERT INTO bangumi (id, title) VALUES ('old1', 'OLD')");
  await pool.query(
    "INSERT INTO points (id, bangumi_id, name, location)"
    + " VALUES ('op1', 'old1', 'old', ST_SetSRID(ST_MakePoint(1, 1), 4326)::geography)",
  );
  await pool.query("INSERT INTO sessions (id) VALUES (gen_random_uuid()::text)");
  await pool.query(
    "INSERT INTO saved_routes (user_id, title, point_ids) VALUES ('u1', 'seed', ARRAY['pp1'])",
  );
}

async function buildSnapshotSource(): Promise<ReturnType<typeof fakeSnapshotSource>> {
  const exported = await exportCandidate(query, "snapshots/import/data");
  const manifest = buildManifest(exported, "snap-daily-2026-08-14", "daily-2026-08-14", "2026-08-14T00:00:00Z");
  const f = fakeSnapshotSource();
  f.setManifest(manifest);
  for (const object of exported.objects) {
    const entry = object as { body: ArrayBuffer; key: string };
    f.objects().set(entry.key, { body: entry.body });
  }
  return f;
}

/** Seed production, capture its snapshot, then leave the staging baseline in place. */
async function stagedImportSource(): Promise<ReturnType<typeof fakeSnapshotSource>> {
  await truncateCatalogPool(pool);
  await seedProductionSet();
  const source = await buildSnapshotSource();
  await truncateCatalogPool(pool);
  await seedStagingBaseline();
  return source;
}

async function idsOf(table: string): Promise<string[]> {
  const { rows } = await pool.query(`SELECT id FROM ${table} ORDER BY id`);
  return (rows as { id: string }[]).map((row) => row.id);
}

async function countOf(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*) AS c FROM ${table}`);
  return Number((rows as { c: string }[])[0]?.c ?? -1);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  seam = await openPlanePrisma();
  query = seam.query;
  await truncateCatalogPool(pool);
}, 120_000);

afterAll(async () => {
  await seam.dispose();
  await pool.end();
});

databaseDescribe("import atomic switch (AC4)", () => {
  it("a valid import atomically replaces the staging Catalog", async () => {
    const source = await stagedImportSource();

    expect((await importSnapshot(source.source, query)).status).toBe("imported");

    expect(await idsOf("bangumi")).toEqual(["prod1", "prod2"]);
    expect(await idsOf("points")).toEqual(["pp1"]);
  });

  it("keeps every exported column across the round trip", async () => {
    const source = await stagedImportSource();

    expect((await importSnapshot(source.source, query)).status).toBe("imported");

    const { rows: works } = await pool.query("SELECT title_cn FROM bangumi WHERE id = 'prod1'");
    expect((works as { title_cn: string | null }[])[0]?.title_cn).toBe("幸運星");
    const { rows: points } = await pool.query(
      "SELECT latitude, longitude, episode, time_seconds FROM points WHERE id = 'pp1'",
    );
    expect(points[0]).toEqual({ latitude: 36.1, longitude: 139.6, episode: 3, time_seconds: 42 });
  });

  it("an invalid import performs ZERO activation", async () => {
    const source = await stagedImportSource();
    const before = await idsOf("bangumi");
    const manifest = source.manifest();
    if (manifest !== null) {
      source.setManifest({
        ...manifest,
        objects: manifest.objects.map((o) => (o.kind === "works" ? { ...o, hash: "0".repeat(64) } : o)),
      });
    }

    expect((await importSnapshot(source.source, query)).status).toBe("invalid");

    expect(await idsOf("bangumi")).toEqual(before);
  });
});

databaseDescribe("staging holds public Catalog only (AC6)", () => {
  it("a valid import never writes user-domain records", async () => {
    await truncateCatalogPool(pool);
    await seedProductionSet();
    const source = await buildSnapshotSource();
    await truncateCatalogPool(pool);
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM saved_routes");

    expect((await importSnapshot(source.source, query)).status).toBe("imported");

    expect(await countOf("sessions")).toBe(0);
    expect(await countOf("saved_routes")).toBe(0);
    expect(await countOf("bangumi")).toBeGreaterThan(0);
  });
});
