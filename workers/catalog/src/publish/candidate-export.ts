/**
 * Candidate export for the immutable catalog snapshot layer (issue #1012, AC1).
 *
 * Reads ONLY the public, catalog-owned tables — works, points, aliases, series
 * edges, provenance/source maps, and original-image asset metadata — into a
 * deterministic candidate inventory of row objects (JSON bytes + SHA-256 hash +
 * byte size). Auth, user, session, lock, and private run-log tables are NOT in
 * the export allowlist (EXPORTED_TABLES), so a candidate can never carry them
 * (AC1).
 *
 * Statements are built with the Drizzle query builder + executed through the
 * single CatalogDb seam; no complete SQL lives here.
 */
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { jsonToArrayBuffer } from "./bytes";
import {
  aliases, bangumi, catalogProvenance, mediaAssets, points, seriesEdges,
} from "../db/schema";

/** The kinds of exported row-bundles in a snapshot. */
export type ExportKind =
  | "works" | "points" | "aliases" | "series" | "provenance" | "media";

/** A single exported row bundle: JSON bytes + content hash + size. */
export interface ExportObject {
  kind: ExportKind;
  key: string;
  body: ArrayBuffer;
  hash: string;
  sizeBytes: number;
}

/** Per-table row counts recorded in the manifest (AC2). */
export interface ExportCounts {
  works: number;
  points: number;
  aliases: number;
  series: number;
  provenance: number;
  media: number;
}

/** The result of a candidate export against the catalog data plane. */
export interface CandidateExport {
  objects: readonly ExportObject[];
  counts: ExportCounts;
  /** Proof of the export allowlist; public catalog tables only (AC1). */
  exportedTables: readonly string[];
}

/** Public catalog tables eligible for export; nothing private is allowed. */
export const EXPORTED_TABLES = [
  "bangumi", "points", "aliases", "series_edges", "catalog_provenance", "media_assets",
] as const;

function emptyCounts(): ExportCounts {
  return { works: 0, points: 0, aliases: 0, series: 0, provenance: 0, media: 0 };
}

/** Export the public catalog rows for a snapshot under the given key prefix. */
export async function exportCandidate(
  db: CatalogDb, keyPrefix: string,
): Promise<CandidateExport> {
  const rows = await readAllPublicRows(db);
  const objects = await Promise.all(rows.map((entry) => bundle(db, entry.kind, keyPrefix, entry.rows)));
  return { objects, counts: countsOf(rows), exportedTables: EXPORTED_TABLES };
}

/** Fetch every public table's rows (each to its own kind group). */
async function readAllPublicRows(db: CatalogDb): Promise<readonly { kind: ExportKind; rows: readonly unknown[] }[]> {
  return [
    { kind: "works", rows: await readWorks(db) },
    { kind: "points", rows: await readPoints(db) },
    { kind: "aliases", rows: await readAliases(db) },
    { kind: "series", rows: await readSeries(db) },
    { kind: "provenance", rows: await readProvenance(db) },
    { kind: "media", rows: await readMedia(db) },
  ];
}

/** Fold per-kind row counts into the manifest counts shape. */
function countsOf(entries: readonly { kind: ExportKind; rows: readonly unknown[] }[]): ExportCounts {
  const counts = emptyCounts();
  for (const entry of entries) counts[entry.kind] = entry.rows.length;
  return counts;
}

/** Serialize a table's rows to one immutable export object (hash + size). */
async function bundle(
  _db: CatalogDb, kind: ExportKind, keyPrefix: string, rows: readonly unknown[],
): Promise<ExportObject> {
  const body = jsonToArrayBuffer(rows);
  const hash = await sha256Hex(body);
  return { kind, key: keyPrefix + "/" + kind + ".json", body, hash, sizeBytes: body.byteLength };
}

async function readWorks(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      id: bangumi.id, title: bangumi.title, titleCn: bangumi.titleCn,
      coverUrl: bangumi.coverUrl, airDate: bangumi.airDate, summary: bangumi.summary,
      epsCount: bangumi.epsCount, rating: bangumi.rating, pointsCount: bangumi.pointsCount,
      primaryColor: bangumi.primaryColor, city: bangumi.city, platform: bangumi.platform,
      updatedAt: bangumi.updatedAt,
    })
    .from(bangumi)
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readPoints(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      id: points.id, bangumiId: points.bangumiId, name: points.name, nameCn: points.nameCn,
      latitude: points.latitude, longitude: points.longitude, image: points.image,
      episode: points.episode, timeSeconds: points.timeSeconds, sceneDesc: points.sceneDesc,
      origin: points.origin, originUrl: points.originUrl, city: points.city,
    })
    .from(points)
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readAliases(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      bangumiId: aliases.bangumiId, alias: aliases.alias,
      aliasNormalized: aliases.aliasNormalized, source: aliases.source, priority: aliases.priority,
    })
    .from(aliases)
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readSeries(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      fromBangumiId: seriesEdges.fromBangumiId,
      toBangumiId: seriesEdges.toBangumiId,
      relation: seriesEdges.relation,
    })
    .from(seriesEdges)
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readProvenance(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      scope: catalogProvenance.scope, entityId: catalogProvenance.entityId,
      workId: catalogProvenance.workId, source: catalogProvenance.source,
      upstreamId: catalogProvenance.upstreamId, attribution: catalogProvenance.attribution,
      license: catalogProvenance.license, fieldMap: catalogProvenance.fieldMap,
      capturedAt: catalogProvenance.capturedAt,
    })
    .from(catalogProvenance)
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readMedia(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      pointId: mediaAssets.pointId, r2Key: mediaAssets.r2Key,
      contentHash: mediaAssets.contentHash, tombstoned: mediaAssets.tombstoned,
    })
    .from(mediaAssets)
    .getSQL();
  return (await db.execute(statement)).rows;
}

/** SHA-256 hex digest of the given bytes (the fallback content hash). */
async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
