/**
 * Immutable snapshot integration spike (issue #1012, AC1-AC6).
 *
 * Runs the export -> manifest -> validate -> activate -> gc pipeline against a
 * real Neon Postgres (complete Atlas schema) with an in-memory object store.
 *   AC1: export contains only public catalog data; auth/user/run-log rows absent.
 *   AC2: manifest records schema version, source run id, hashes, counts, time, compat.
 *   AC3: validation failure leaves current unchanged; success moves previous and activates.
 *   AC6: failed publishes do not leak staged candidate objects.
 * The spike is skipped offline (no Neon) and runs in CI (catalog-spikes).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { exportCandidate, EXPORTED_TABLES } from "../src/publish/candidate-export";
import { buildManifest, MANIFEST_SCHEMA_VERSION } from "../src/publish/manifest";
import { publishSnapshot, readCurrentSnapshot } from "../src/publish/snapshot";
import { gcSnapshots } from "../src/publish/snapshot-gc";
import { readPointer } from "../src/publish/pointer";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";
import { textToArrayBuffer } from "../src/publish/bytes";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

let db: CatalogDb;

async function seedPublic(): Promise<void> {
  await db.execute(sql`INSERT INTO bangumi (id, title) VALUES ('w1', 'Lucky Star'), ('w2', 'Slow Loop')`);
  await db.execute(sql`INSERT INTO points (id, bangumi_id, name, latitude, longitude, image) VALUES
    ('p1', 'w1', 'Gate', 36.1, 139.6, '/gate.png'),
    ('p2', 'w1', 'School', 35.6, 139.7, '/school.png'),
    ('p3', 'w2', 'Bay', 34.0, 135.0, null)`);
  await db.execute(sql`INSERT INTO aliases (bangumi_id, alias, alias_normalized, source, priority) VALUES
    ('w1', 'らき☆すた', 'らきすた', 'bangumi', 0)`);
  await db.execute(sql`INSERT INTO series_edges (from_bangumi_id, to_bangumi_id, relation) VALUES ('w1', 'w2', 'sequel')`);
  await db.execute(sql`INSERT INTO catalog_provenance (scope, entity_id, work_id, source, attribution, license) VALUES
    ('work', 'w1', 'w1', 'bangumi', null, null),
    ('point', 'p1', 'w1', 'anitabi', 'Anitabi', 'https://anitabi.cn')`);
  await db.execute(sql`INSERT INTO media_assets (point_id, r2_key, content_hash, tombstoned) VALUES
    ('p1', 'points/p1', 'aa'.repeat(32), false)`);
}

async function seedPrivate(): Promise<void> {
  await db.execute(sql`INSERT INTO ingest_jobs (work_id, status) VALUES ('private-1', 'done')`);
  await db.execute(sql`INSERT INTO catalog_runs (run_id, status) VALUES ('private-run', 'complete')`);
  await db.execute(sql`INSERT INTO raw_payload_history (work_id, source, payload) VALUES ('private-1', 'bangumi', '{}'::jsonb)`);
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
  await seedPublic();
  await seedPrivate();
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("Candidate export contains only public catalog data (AC1)", () => {
  it("exports public works, points, aliases, series, provenance, and media metadata", async () => {
    const exported = await exportCandidate(db, "snapshots/snap-e2e/data");
    expect(exported.objects).toHaveLength(6);
    expect(exported.counts).toEqual({ works: 2, points: 3, aliases: 1, series: 1, provenance: 2, media: 1 });
    const media = exported.objects.find((o) => o.kind === "media");
    const body = media ? new TextDecoder().decode(media.body) : "";
    expect(body).toContain("points/p1");
  });

  it("never carries auth, user, lock, or private run-log rows", async () => {
    const exported = await exportCandidate(db, "snapshots/snap-e2e/data");
    expect(exported.exportedTables).toEqual([...EXPORTED_TABLES]);
    const allText = exported.objects.map((o) => new TextDecoder().decode(o.body)).join("");
    expect(allText).not.toContain("private-1");
    expect(allText).not.toContain("private-run");
    for (const privateTable of ["sessions", "request_log", "ingest_jobs", "catalog_runs"]) {
      expect(EXPORTED_TABLES).not.toContain(privateTable);
    }
  });
});

databaseDescribe("Manifest shape (AC2)", () => {
  it("records schema version, source run id, object hashes, counts, creation time, and compatibility", async () => {
    const exported = await exportCandidate(db, "snapshots/snap-m/data");
    const manifest = buildManifest(exported, "snap-m", "daily-2026-08-14", "2026-08-14T00:00:00Z");
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.sourceRunId).toBe("daily-2026-08-14");
    expect(manifest.createdAt).toBe("2026-08-14T00:00:00Z");
    expect(manifest.counts.works).toBe(2);
    expect(manifest.objects.every((o) => /^[0-9a-f]{64}$/.test(o.hash))).toBe(true);
    expect(manifest.compatibility).toEqual({ min: "1", max: "1" });
  });
});

databaseDescribe("Atomic activation (AC3)", () => {
  it("a validation failure leaves the current pointer unchanged and cleans the candidate", async () => {
    const { store, keys } = inMemoryObjectStore();
    const reject = () => Promise.resolve({ valid: false, reason: "forced" });
    const first = await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    expect(first.status).toBe("published");
    await publishSnapshot({ db, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" }, reject);
    const pointer = await readPointer(store);
    expect(pointer.current).toBe("snap-daily-1");
    expect(keys().some((k) => k.includes("snap-daily-2"))).toBe(false);
  });

  it("valid publish moves previous to old and activates the new run atomically", async () => {
    const { store } = inMemoryObjectStore();
    await publishSnapshot({ db, store }, { sourceRunId: "daily-3", createdAt: "2026-08-16T00:00:00Z" });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-4", createdAt: "2026-08-17T00:00:00Z" });
    expect(await readPointer(store)).toEqual({ current: "snap-daily-4", previous: "snap-daily-3" });
  });
});

databaseDescribe("GC retains N and N-1 and never deletes reachable objects (AC4)", () => {
  it("keeps current+previous plus the pointer, deleting older and abandoned snapshots", async () => {
    const { store, keys } = inMemoryObjectStore();
    await publishSnapshot({ db, store }, { sourceRunId: "daily-5", createdAt: "2026-08-18T00:00:00Z" });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-6", createdAt: "2026-08-19T00:00:00Z" });
    await store.put("snapshots/snap-orphan/data/works.json", { body: textToArrayBuffer("[]") });

    const result = await gcSnapshots(store, 2);

    expect(result.retained).toContain("snap-daily-6");
    expect(result.retained).toContain("snap-daily-5");
    expect(keys()).toContain("snapshots/pointer.json");
    expect(keys().some((k) => k.includes("snap-orphan"))).toBe(false);
    expect(keys().some((k) => k.includes("snap-daily-6"))).toBe(true);
  });
});

databaseDescribe("Failed publishes do not leak unbounded candidates (AC6)", () => {
  it("a rejected candidate is removed from the object store and the reader still sees the current snapshot", async () => {
    const { store, keys } = inMemoryObjectStore();
    const reject = () => Promise.resolve({ valid: false, reason: "forced" });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-7", createdAt: "2026-08-20T00:00:00Z" });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-8", createdAt: "2026-08-21T00:00:00Z" }, reject);
    expect(keys().filter((k) => k.startsWith("snapshots/") && !k.includes("snap-daily-7") && k !== "snapshots/pointer.json").length).toBe(0);
    expect((await readCurrentSnapshot({ db, store }))?.snapshotId).toBe("snap-daily-7");
  });
});
