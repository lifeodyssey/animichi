/**
 * Snapshot manifest worker tests (issue #1012, AC2 support).
 *
 * buildManifest is pure: it records the schema version, source run id, the
 * per-object hashes + byte sizes, the row/object counts, the injected creation
 * time, and the compatibility range. These are the exact AC2 fields.
 */
import { describe, expect, it } from "vitest";
import type { CandidateExport } from "../src/publish/candidate-export";
import { buildManifest, COMPATIBILITY, MANIFEST_SCHEMA_VERSION } from "../src/publish/manifest";

function candidate(objects: CandidateExport["objects"]): CandidateExport {
  return {
    objects,
    counts: { works: 1, points: 2, aliases: 0, series: 0, provenance: 1, media: 1 },
    exportedTables: ["bangumi", "points", "aliases", "series_edges", "catalog_provenance", "media_assets"],
  };
}

describe("buildManifest (AC2 support)", () => {
  it("records schema version, source run id, hashes, counts, creation time, and compatibility", () => {
    const export_ = candidate([
      { kind: "works", key: "snapshots/snap-daily-1/data/works.json", body: new ArrayBuffer(0), hash: "a".repeat(64), sizeBytes: 4 },
      { kind: "points", key: "snapshots/snap-daily-1/data/points.json", body: new ArrayBuffer(0), hash: "b".repeat(64), sizeBytes: 8 },
    ]);
    const manifest = buildManifest(export_, "snap-daily-1", "daily-1", "2026-08-14T00:00:00Z");
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.sourceRunId).toBe("daily-1");
    expect(manifest.snapshotId).toBe("snap-daily-1");
    expect(manifest.createdAt).toBe("2026-08-14T00:00:00Z");
    expect(manifest.compatibility).toEqual(COMPATIBILITY);
  });

  it("carries the per-object hashes and byte sizes verbatim", () => {
    const manifest = buildManifest(
      candidate([
        { kind: "series", key: "snapshots/snap-x/data/series.json", body: new ArrayBuffer(0), hash: "c".repeat(64), sizeBytes: 12 },
      ]),
      "snap-x", "daily-x", "2026-08-14T00:00:00Z",
    );
    expect(manifest.objects).toEqual([
      { kind: "series", key: "snapshots/snap-x/data/series.json", hash: "c".repeat(64), sizeBytes: 12 },
    ]);
    expect(manifest.counts.points).toBe(2);
    expect(manifest.counts.media).toBe(1);
  });
});
