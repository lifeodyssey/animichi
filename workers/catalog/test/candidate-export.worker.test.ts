/**
 * Candidate export worker tests (issue #1012, AC1 support).
 *
 * Proves the export allowlist is restricted to public catalog tables (works,
 * points, aliases, series, provenance, media) and that a fake-backed export
 * produces deterministic JSON objects with content hashes + per-table counts.
 * The authoritative AC1 integration proof (private tables absent on a real DB)
 * lives in the spike suite.
 */
import { describe, expect, it } from "vitest";
import { EXPORTED_TABLES, exportCandidate } from "../src/publish/candidate-export";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";

const ROWS = {
  bangumi: [{ id: "w1", title: "Lucky Star" }],
  points: [{ id: "p1", bangumiId: "w1", name: "Gate", latitude: 36.1, longitude: 139.6 }],
  aliases: [{ bangumiId: "w1", alias: "らき☆すた", aliasNormalized: "らきすた", source: "bangumi", priority: 0 }],
  series_edges: [{ fromBangumiId: "w1", toBangumiId: "w2", relation: "sequel" }],
  catalog_provenance: [{ scope: "work", entityId: "w1", source: "bangumi" }],
  media_assets: [{ pointId: "p1", r2Key: "points/p1", contentHash: "abc", tombstoned: false }],
};

describe("candidate export allowlist (AC1)", () => {
  it("exposes only public catalog tables, never auth/user/lock/run-log tables", () => {
    expect(EXPORTED_TABLES).toEqual([
      "bangumi", "points", "aliases", "series_edges", "catalog_provenance", "media_assets",
    ]);
    for (const privateTable of ["sessions", "request_log", "ingest_jobs", "raw_anitabi", "raw_bangumi", "catalog_runs", "saved_routes"]) {
      expect(EXPORTED_TABLES).not.toContain(privateTable);
    }
  });
});

describe("candidate export content (AC1 support)", () => {
  it("serializes each public table to an immutable object with a hash, size, and count", async () => {
    const exported = await exportCandidate(fakeCatalogDb(ROWS), "snapshots/snap-a/data");
    expect(exported.counts).toEqual({ works: 1, points: 1, aliases: 1, series: 1, provenance: 1, media: 1 });
    expect(exported.objects).toHaveLength(6);
    const samples = exported.objects.map((object) => ({
      kind: object.kind,
      key: object.key,
      hashOk: /^[0-9a-f]{64}$/.test(object.hash),
      sizeOk: object.sizeBytes > 0,
    }));
    expect(samples).toHaveLength(6);
    expect(samples.every((sample) => sample.key.includes(sample.kind))).toBe(true);
    expect(samples.every((sample) => sample.hashOk && sample.sizeOk)).toBe(true);
    expect(samples.map((s) => s.key).sort()).toEqual([
      "snapshots/snap-a/data/aliases.json",
      "snapshots/snap-a/data/media.json",
      "snapshots/snap-a/data/points.json",
      "snapshots/snap-a/data/provenance.json",
      "snapshots/snap-a/data/series.json",
      "snapshots/snap-a/data/works.json",
    ]);
  });

  it("produces identical hashes for two exports of the same rows (deterministic order)", async () => {
    const db = fakeCatalogDb(ROWS);
    const first = await exportCandidate(db, "snapshots/snap-a/data");
    const second = await exportCandidate(db, "snapshots/snap-a/data");
    expect(first.objects.map((o) => o.hash)).toEqual(second.objects.map((o) => o.hash));
    expect(first.objects.map((o) => [o.kind, o.hash])).toEqual(second.objects.map((o) => [o.kind, o.hash]));
  });
});
