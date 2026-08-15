/**
 * Staging snapshot import integration (issue #1016, AC3/AC4/AC6).
 *
 * Runs the real import pipeline (importSnapshot -> neonImportActivation's
 * no-migration db.batch atomic switch) against a real Neon database:
 *   AC3 output staged from a real production-shaped export+manifest.  AC4: an
 *   invalid import performs ZERO activation (staging tables untouched); a valid
 *   import atomically replaces the staging Catalog in one transaction.  AC6:
 *   after import, staging holds the public Catalog and NO auth/user-domain
 *   records (sessions/request_log stay empty). Skipped offline (no Neon).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { exportCandidate } from "../src/publish/candidate-export";
import { buildManifest } from "../src/publish/manifest";
import { importSnapshot } from "../src/import/import-snapshot";
import { fakeSnapshotSource } from "./fakes/fake-snapshot-source";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";

let db: CatalogDb;

async function seedProductionSet(): Promise<void> {
  await db.execute(sql`INSERT INTO bangumi (id, title) VALUES ('prod1', 'Lucky Star'), ('prod2', 'Slow Loop')`);
  await db.execute(sql`INSERT INTO points (id, bangumi_id, name, latitude, longitude) VALUES ('pp1', 'prod1', 'gate', 36.1, 139.6)`);
  await db.execute(sql`INSERT INTO catalog_provenance (scope, entity_id, work_id, source) VALUES ('work', 'prod1', 'prod1', 'bangumi')`);
}

async function seedStagingBaseline(): Promise<void> {
  await db.execute(sql`INSERT INTO bangumi (id, title) VALUES ('old1', 'OLD')`);
  await db.execute(sql`INSERT INTO points (id, bangumi_id, name, latitude, longitude) VALUES ('op1', 'old1', 'old', 1, 1)`);
  await db.execute(sql`INSERT INTO sessions (id) VALUES (gen_random_uuid())`);
  await db.execute(sql`INSERT INTO request_log (id) VALUES (gen_random_uuid())`);
}

async function buildSnapshotSource(): Promise<ReturnType<typeof fakeSnapshotSource>> {
  const exported = await exportCandidate(db, "snapshots/import/data");
  const snapshotId = "snap-daily-2026-08-14";
  const manifest = buildManifest(exported, snapshotId, "daily-2026-08-14", "2026-08-14T00:00:00Z");
  const f = fakeSnapshotSource();
  f.setManifest(manifest);
  for (const object of exported.objects) {
    const entry = object as { body: ArrayBuffer; key: string };
    f.objects().set(entry.key, { body: entry.body });
  }
  return f;
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

/** Read a scalar count() result defensively (rows are typed unknown). */
async function countOf(query: SQL): Promise<number> {
  const result = await db.execute(query);
  const row = result.rows[0];
  if (row === undefined || typeof row !== "object" || !("c" in row)) throw new Error("count query returned no count");
  const value = (row as { c: unknown }).c;
  return typeof value === "number" ? value : Number(value);
}

databaseDescribe("import atomic switch (AC4)", () => {
  it("a valid import atomically replaces the staging Catalog", async () => {
    await truncateCatalog(db);
    await seedProductionSet();
    const source = await buildSnapshotSource();
    await truncateCatalog(db);
    await seedStagingBaseline();

    const result = await importSnapshot(source.source, db);
    expect(result.status).toBe("imported");

    const bangumi = (await db.execute(sql`SELECT id FROM bangumi ORDER BY id`)).rows.map((r) => r.id);
    expect(bangumi).toEqual(["prod1", "prod2"]);
    expect(bangumi).not.toContain("old1");
    const points = (await db.execute(sql`SELECT id FROM points`)).rows.map((r) => r.id);
    expect(points).toEqual(["pp1"]);
  });

  it("an invalid import performs ZERO activation", async () => {
    await truncateCatalog(db);
    await seedProductionSet();
    const source = await buildSnapshotSource();
    await truncateCatalog(db);
    await seedStagingBaseline();
    const before = (await db.execute(sql`SELECT id FROM bangumi`)).rows.map((r) => r.id).sort();
    const manifest = source.manifest();
    if (manifest !== null) {
      const tampered = { ...manifest, objects: manifest.objects.map((o) => (o.kind === "works" ? { ...o, hash: "0".repeat(64) } : o)) };
      source.setManifest(tampered);
    }
    const result = await importSnapshot(source.source, db);
    expect(result.status).toBe("invalid");
    const after = (await db.execute(sql`SELECT id FROM bangumi`)).rows.map((r) => r.id).sort();
    expect(after).toEqual(before);
  });
});

databaseDescribe("staging holds public Catalog only (AC6)", () => {
  it("a valid import never writes auth/user-domain records", async () => {
    await truncateCatalog(db);
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM request_log`);
    await seedProductionSet();
    const source = await buildSnapshotSource();
    await truncateCatalog(db);
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM request_log`);

    const result = await importSnapshot(source.source, db);
    expect(result.status).toBe("imported");

    expect(await countOf(sql`SELECT count(*) AS c FROM sessions`)).toBe(0);
    expect(await countOf(sql`SELECT count(*) AS c FROM request_log`)).toBe(0);
    expect(await countOf(sql`SELECT count(*) AS c FROM bangumi`)).toBeGreaterThan(0);
  });
});
