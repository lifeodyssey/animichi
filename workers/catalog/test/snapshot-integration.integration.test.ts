/**
 * Immutable snapshot integration suite (issue #1012, AC1-AC6).
 *
 * Runs the export -> manifest -> validate -> activate -> gc pipeline against a
 * real Postgres — the committed Prisma chain's schema, cloned into the suite
 * database — with an in-memory object store.
 *   AC1: export contains only public catalog data; auth/user/run-log rows absent.
 *   AC2: manifest records schema version, source run id, hashes, counts, time, compat.
 *   AC3: validation failure leaves current unchanged; success moves previous and activates.
 *   AC6: failed publishes do not leak staged candidate objects.
 * The suite runs against the hermetic Docker Postgres arm (`test/integration-db-global.ts`); a missing database fails loudly instead of skipping (card 1049).
 *
 * Since #1630 the export reads through the plan seam, so this file runs on the
 * PLANE database (like publish.integration.test.ts): the rows it seeds are the
 * shape every real environment has, and `points.latitude`/`longitude` are the
 * generated columns the export reads back.
 */
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { exportCandidate, EXPORTED_TABLES } from "../src/publish/candidate-export";
import { buildManifest, MANIFEST_SCHEMA_VERSION } from "../src/publish/manifest";
import { publishSnapshot, readCurrentSnapshot } from "../src/publish/snapshot";
import { gcSnapshots } from "../src/publish/snapshot-gc";
import { readPointer } from "../src/publish/pointer";
import { databaseDescribe, openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";
import { textToArrayBuffer } from "../src/publish/bytes";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

let pool: pg.Pool;
let query: CatalogPrisma;
let seams: PlaneSeams;

async function seedPublic(): Promise<void> {
  await pool.query("INSERT INTO bangumi (id, title) VALUES ('w1', 'Lucky Star'), ('w2', 'Slow Loop')");
  await pool.query(
    "INSERT INTO points (id, bangumi_id, name, location, image) VALUES"
    + " ('p1', 'w1', 'Gate', ST_SetSRID(ST_MakePoint(139.6, 36.1), 4326)::geography, '/gate.png'),"
    + " ('p2', 'w1', 'School', ST_SetSRID(ST_MakePoint(139.7, 35.6), 4326)::geography, '/school.png'),"
    + " ('p3', 'w2', 'Bay', ST_SetSRID(ST_MakePoint(135.0, 34.0), 4326)::geography, null)",
  );
  await pool.query(
    "INSERT INTO aliases (bangumi_id, alias, alias_normalized, source, priority) VALUES"
    + " ('w1', 'らき☆すた', 'らきすた', 'bangumi', 0)",
  );
  await pool.query("INSERT INTO series_edges (from_bangumi_id, to_bangumi_id, relation) VALUES ('w1', 'w2', 'sequel')");
  await pool.query(
    "INSERT INTO catalog_provenance (scope, entity_id, work_id, source, attribution, license) VALUES"
    + " ('work', 'w1', 'w1', 'bangumi', null, null),"
    + " ('point', 'p1', 'w1', 'anitabi', 'Anitabi', 'https://anitabi.cn')",
  );
  await pool.query(
    "INSERT INTO media_assets (point_id, r2_key, content_hash, tombstoned) VALUES ('p1', 'points/p1', $1, false)",
    ["aa".repeat(32)],
  );
}

async function seedPrivate(): Promise<void> {
  await pool.query("INSERT INTO ingest_jobs (work_id, status) VALUES ('private-1', 'done')");
  await pool.query("INSERT INTO catalog_runs (run_id, status) VALUES ('private-run', 'complete')");
  await pool.query(
    "INSERT INTO raw_payload_history (work_id, source, payload) VALUES ('private-1', 'bangumi', '{}'::jsonb)",
  );
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  pool = seams.pool;
  query = seams.query;
  await truncateCatalogPool(pool);
  await seedPublic();
  await seedPrivate();
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

databaseDescribe("Candidate export contains only public catalog data (AC1)", () => {
  it("exports public works, points, aliases, series, provenance, and media metadata", async () => {
    const exported = await exportCandidate(query, "snapshots/snap-e2e/data");
    expect(exported.objects).toHaveLength(6);
    expect(exported.counts).toEqual({ works: 2, points: 3, aliases: 1, series: 1, provenance: 2, media: 1 });
    const media = exported.objects.find((o) => o.kind === "media");
    const body = media ? new TextDecoder().decode(media.body) : "";
    expect(body).toContain("points/p1");
  });

  it("carries the snapshot's own JSON keys, not the columns' names (AC1 shape)", async () => {
    const exported = await exportCandidate(query, "snapshots/snap-e2e/data");
    const points = exported.objects.find((o) => o.kind === "points");
    const rows = JSON.parse(points ? new TextDecoder().decode(points.body) : "[]") as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ id: "p1", bangumiId: "w1", nameCn: null, image: "/gate.png" });
  });

  it("never carries auth, user, lock, or private run-log rows", async () => {
    const exported = await exportCandidate(query, "snapshots/snap-e2e/data");
    expect(exported.exportedTables).toEqual([...EXPORTED_TABLES]);
    const allText = exported.objects.map((o) => new TextDecoder().decode(o.body)).join("");
    expect(allText).not.toContain("private-1");
    expect(allText).not.toContain("private-run");
    for (const privateTable of ["sessions", "request_log", "ingest_jobs", "catalog_runs"]) {
      expect(EXPORTED_TABLES).not.toContain(privateTable);
    }
  });

  it("produces identical object hashes across two exports of the same rows (deterministic ORDER BY)", async () => {
    const first = await exportCandidate(query, "snapshots/snap-det/data");
    const second = await exportCandidate(query, "snapshots/snap-det/data");
    expect(first.objects.map((o) => o.hash)).toEqual(second.objects.map((o) => o.hash));
    expect(first.objects.map((o) => [o.kind, o.key])).toEqual(second.objects.map((o) => [o.kind, o.key]));
  });
});

databaseDescribe("Manifest shape (AC2)", () => {
  it("records schema version, source run id, object hashes, counts, creation time, and compatibility", async () => {
    const exported = await exportCandidate(query, "snapshots/snap-m/data");
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
  it("a validation failure leaves the store untouched and the pointer unchanged", async () => {
    const { store, keys } = inMemoryObjectStore();
    const reject = () => Promise.resolve({ valid: false, reason: "forced" });
    const first = await publishSnapshot({ query, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    expect(first.status).toBe("published");
    await publishSnapshot({ query, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" }, reject);
    const pointer = await readPointer(store);
    expect(pointer.current).toBe("snap-daily-1");
    expect(keys().some((k) => k.includes("snap-daily-2"))).toBe(false);
  });

  it("a same-run-id re-publish that fails validation never deletes the live snapshot", async () => {
    const { store, keys } = inMemoryObjectStore();
    const reject = () => Promise.resolve({ valid: false, reason: "forced" });
    await publishSnapshot({ query, store }, { sourceRunId: "daily-9", createdAt: "2026-08-22T00:00:00Z" });
    const liveDataKeys = keys().filter((k) => k.startsWith("snapshots/snap-daily-9/data/"));
    expect(liveDataKeys.length).toBeGreaterThan(0);
    await publishSnapshot({ query, store }, { sourceRunId: "daily-9", createdAt: "2026-08-22T00:00:00Z" }, reject);
    expect((await readPointer(store)).current).toBe("snap-daily-9");
    for (const key of liveDataKeys) expect(keys()).toContain(key);
  });

  it("valid publish moves previous to old and activates the new run atomically", async () => {
    const { store } = inMemoryObjectStore();
    await publishSnapshot({ query, store }, { sourceRunId: "daily-3", createdAt: "2026-08-16T00:00:00Z" });
    await publishSnapshot({ query, store }, { sourceRunId: "daily-4", createdAt: "2026-08-17T00:00:00Z" });
    expect(await readPointer(store)).toEqual({ current: "snap-daily-4", previous: "snap-daily-3" });
  });
});

databaseDescribe("GC retains N and N-1 and never deletes reachable objects (AC4)", () => {
  it("keeps current+previous plus the pointer, deleting older and abandoned snapshots", async () => {
    const { store, keys } = inMemoryObjectStore();
    await publishSnapshot({ query, store }, { sourceRunId: "daily-5", createdAt: "2026-08-18T00:00:00Z" });
    await publishSnapshot({ query, store }, { sourceRunId: "daily-6", createdAt: "2026-08-19T00:00:00Z" });
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
    await publishSnapshot({ query, store }, { sourceRunId: "daily-7", createdAt: "2026-08-20T00:00:00Z" });
    await publishSnapshot({ query, store }, { sourceRunId: "daily-8", createdAt: "2026-08-21T00:00:00Z" }, reject);
    expect(keys().filter((k) => k.startsWith("snapshots/") && !k.includes("snap-daily-7") && k !== "snapshots/pointer.json").length).toBe(0);
    expect((await readCurrentSnapshot({ query, store }))?.snapshotId).toBe("snap-daily-7");
  });
});
