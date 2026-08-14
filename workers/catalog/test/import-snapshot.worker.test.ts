/**
 * Staging snapshot import validation + orchestration (issue #1016, AC3/AC4).
 *
 * Worker-pool test over the import pipeline: validation rejects an incompatible
 * schema, a non-public kind, a hash mismatch, a count mismatch, missing
 * provenance, or a missing source run — and an invalid import performs ZERO
 * activation (AC4). A valid import activates exactly once. The atomic db.batch
 * swap itself is exercised against a real database in
 * import-integration.spike.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  importSnapshot,
  validateImport,
  type ImportCandidate,
  type ImportObject,
} from "../src/import/import-snapshot";
import { MANIFEST_SCHEMA_VERSION, COMPATIBILITY, type SnapshotManifest } from "../src/publish/manifest";
import { jsonToArrayBuffer } from "../src/publish/bytes";
import { fakeSnapshotSource } from "./fakes/fake-snapshot-source";

async function sha256(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function object(kind: string, rows: unknown[]): Promise<ImportObject> {
  const body = jsonToArrayBuffer(rows);
  return { kind: kind as ImportObject["kind"], key: "data/" + kind + ".json", hash: await sha256(body), sizeBytes: body.byteLength, rows };
}

interface Seeded {
  source: ReturnType<typeof fakeSnapshotSource>;
  candidate: ImportCandidate;
  manifest: SnapshotManifest;
}

async function seed(): Promise<Seeded> {
  const objects = await Promise.all([
    object("works", [{ id: "w1", title: "Lucky Star" }]),
    object("points", [{ id: "p1", bangumiId: "w1", name: "gate", latitude: 36.1, longitude: 139.6 }]),
    object("aliases", [{ bangumiId: "w1", alias: "らき", aliasNormalized: "らき", source: "bangumi", priority: 0 }]),
    object("series", []),
    object("provenance", [{ scope: "point", entityId: "p1", workId: "w1", source: "anitabi" }]),
    object("media", []),
  ]);
  const snapshotId = "snap-daily-2026-08-14";
  const candidate: ImportCandidate = { snapshotId, sourceRunId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z", objects };
  const manifest: SnapshotManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    snapshotId: candidate.snapshotId,
    sourceRunId: candidate.sourceRunId,
    createdAt: candidate.createdAt,
    objects: objects.map((o) => ({ kind: o.kind, key: o.key, hash: o.hash, sizeBytes: o.sizeBytes })),
    counts: { works: 1, points: 1, aliases: 1, series: 0, provenance: 1, media: 0 },
    compatibility: COMPATIBILITY,
  };
  const f = fakeSnapshotSource();
  f.setManifest(manifest);
  for (const o of objects) f.objects().set(o.key, { body: jsonToArrayBuffer(o.rows) });
  return { source: f, candidate, manifest };
}

describe("validateImport (AC3)", () => {
  it("accepts a schema, hash, count, provenance, source-run-valid candidate", async () => {
    const { candidate, manifest } = await seed();
    await expect(validateImport(candidate, manifest)).resolves.toEqual({ valid: true });
  });

  it("rejects an unsupported schema compatibility range", async () => {
    const { candidate, manifest } = await seed();
    const bad = { ...manifest, compatibility: { min: "0", max: "0" } };
    await expect(validateImport(candidate, bad)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a snapshot that carries a non-public table", async () => {
    const { manifest } = await seed();
    const badCandidate: ImportCandidate = {
      snapshotId: "s",
      sourceRunId: "daily-2026-08-14",
      createdAt: "t",
      objects: [{ kind: "sessions", key: "x", hash: "a", sizeBytes: 1, rows: [] } as unknown as ImportObject],
    };
    await expect(validateImport(badCandidate, manifest)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a hash mismatch", async () => {
    const { candidate, manifest } = await seed();
    const tampered = candidate.objects.map((o) => ({ ...o, hash: o.kind === "works" ? "0".repeat(64) : o.hash }));
    await expect(validateImport({ ...candidate, objects: tampered }, manifest)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a count mismatch", async () => {
    const { candidate, manifest } = await seed();
    const wrongCount = candidate.objects.map((o) => (o.kind === "works" ? { ...o, rows: [o.rows[0], { id: "w2", title: "x" }] } : o));
    await expect(validateImport({ ...candidate, objects: wrongCount }, manifest)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a snapshot with no provenance rows", async () => {
    const { manifest } = await seed();
    const noProv = [{ kind: "provenance", key: "x", hash: "a", sizeBytes: 1, rows: [] } as unknown as ImportObject];
    await expect(validateImport({ snapshotId: "s", sourceRunId: "daily-2026-08-14", createdAt: "t", objects: noProv }, manifest)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a snapshot lacking a valid source run id", async () => {
    const { candidate } = await seed();
    const manifest: SnapshotManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      snapshotId: "snap-x",
      sourceRunId: "not-a-run",
      createdAt: "t",
      objects: [],
      counts: { works: 0, points: 0, aliases: 0, series: 0, provenance: 0, media: 0 },
      compatibility: COMPATIBILITY,
    };
    await expect(validateImport(candidate, manifest)).resolves.toMatchObject({ valid: false });
  });
});

describe("importSnapshot orchestration (AC3/AC4)", () => {
  it("does NOT activate when validation fails (zero activation)", async () => {
    const { source } = await seed();
    const activated = { calls: 0 };
    const reject = () => Promise.resolve({ valid: false, reason: "forced" });
    const activate = { switchCatalog: () => { activated.calls += 1; return Promise.resolve(); } };
    const result = await importSnapshot(source.source, {} as never, reject, activate);
    expect(result.status).toBe("invalid");
    expect(activated.calls).toBe(0);
  });

  it("activates exactly once when validation passes", async () => {
    const { source } = await seed();
    let activated = 0;
    const activate = { switchCatalog: () => { activated += 1; return Promise.resolve(); } };
    const result = await importSnapshot(source.source, {} as never, undefined, activate);
    expect(result).toEqual({ status: "imported", snapshotId: "snap-daily-2026-08-14" });
    expect(activated).toBe(1);
  });

  it("reports invalid when no snapshot is available", async () => {
    const f = fakeSnapshotSource();
    const result = await importSnapshot(f.source, {} as never, undefined, { switchCatalog: () => Promise.resolve() });
    expect(result.status).toBe("invalid");
  });
});
