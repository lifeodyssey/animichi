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
 * The publish-stage quality gate (X15 #285) interposes between `readPublicRows`
 * and `candidateFromRows`: publishSnapshot gates the spot rows and bundles the
 * publishable remainder, so the snapshot is built from gated rows along the
 * single export data path.
 *
 * Statements are built with the Drizzle query builder + executed through the
 * single CatalogDb seam; no complete SQL lives here.
 */
import { asc } from "drizzle-orm";
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

/**
 * The exported point row, as selected below. `readPoints` executes the
 * statement through the typed `db.execute<ExportedSpotRow>` generic, so the
 * exported points object carries exactly these fields. The Record extension
 * mirrors `versioning.ts`'s row type — the seam the execute generic requires.
 */
export interface ExportedSpotRow extends Record<string, unknown> {
  readonly id: string;
  readonly bangumiId: string | null;
  readonly name: string;
  readonly nameCn: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly image: string | null;
  readonly episode: number | null;
  readonly timeSeconds: number | null;
  readonly sceneDesc: string | null;
  readonly origin: string | null;
  readonly originUrl: string | null;
  readonly city: string | null;
}

/** Every public table's rows, keyed by export kind — the raw candidate material. */
export interface PublicRows {
  readonly works: readonly unknown[];
  readonly points: readonly ExportedSpotRow[];
  readonly aliases: readonly unknown[];
  readonly series: readonly unknown[];
  readonly provenance: readonly unknown[];
  readonly media: readonly unknown[];
}

/** The R2 object key of one exported kind under a key prefix (shared with drift reads). */
export function exportObjectKey(keyPrefix: string, kind: ExportKind): string {
  return keyPrefix + "/" + kind + ".json";
}

/** Export the public catalog rows for a snapshot under the given key prefix. */
export async function exportCandidate(db: CatalogDb, keyPrefix: string): Promise<CandidateExport> {
  return candidateFromRows(await readPublicRows(db), keyPrefix);
}

/** Read every public table's rows (ungated candidate material). */
export async function readPublicRows(db: CatalogDb): Promise<PublicRows> {
  return {
    works: await readWorks(db),
    points: await readPoints(db),
    aliases: await readAliases(db),
    series: await readSeries(db),
    provenance: await readProvenance(db),
    media: await readMedia(db),
  };
}

/** Bundle public rows into a deterministic candidate inventory (hash + size per table). */
export async function candidateFromRows(rows: PublicRows, keyPrefix: string): Promise<CandidateExport> {
  const entries = publicKindEntries(rows);
  const objects = await Promise.all(entries.map((entry) => bundle(keyPrefix, entry.kind, entry.rows)));
  return { objects, counts: countsOf(entries), exportedTables: EXPORTED_TABLES };
}

interface KindRows {
  readonly kind: ExportKind;
  readonly rows: readonly unknown[];
}

/** Every public kind with its rows, in export order. */
function publicKindEntries(rows: PublicRows): readonly KindRows[] {
  return [
    { kind: "works", rows: rows.works },
    { kind: "points", rows: rows.points },
    { kind: "aliases", rows: rows.aliases },
    { kind: "series", rows: rows.series },
    { kind: "provenance", rows: rows.provenance },
    { kind: "media", rows: rows.media },
  ];
}

/** Fold per-kind row counts into the manifest counts shape. */
function countsOf(entries: readonly KindRows[]): ExportCounts {
  const counts = emptyCounts();
  for (const entry of entries) counts[entry.kind] = entry.rows.length;
  return counts;
}

function emptyCounts(): ExportCounts {
  return { works: 0, points: 0, aliases: 0, series: 0, provenance: 0, media: 0 };
}

/** Serialize a table's rows to one immutable export object (hash + size). */
async function bundle(keyPrefix: string, kind: ExportKind, rows: readonly unknown[]): Promise<ExportObject> {
  const body = jsonToArrayBuffer(rows);
  const hash = await sha256Hex(body);
  return { kind, key: exportObjectKey(keyPrefix, kind), body, hash, sizeBytes: body.byteLength };
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
    .orderBy(asc(bangumi.id))
    .getSQL();
  return (await db.execute(statement)).rows;
}

async function readPoints(db: CatalogDb): Promise<readonly ExportedSpotRow[]> {
  const statement = statementBuilder()
    .select({
      id: points.id, bangumiId: points.bangumiId, name: points.name, nameCn: points.nameCn,
      latitude: points.latitude, longitude: points.longitude, image: points.image,
      episode: points.episode, timeSeconds: points.timeSeconds, sceneDesc: points.sceneDesc,
      origin: points.origin, originUrl: points.originUrl, city: points.city,
    })
    .from(points)
    .orderBy(asc(points.id))
    .getSQL();
  const result = await db.execute<ExportedSpotRow>(statement);
  return result.rows;
}

async function readAliases(db: CatalogDb): Promise<unknown[]> {
  const statement = statementBuilder()
    .select({
      bangumiId: aliases.bangumiId, alias: aliases.alias,
      aliasNormalized: aliases.aliasNormalized, source: aliases.source, priority: aliases.priority,
    })
    .from(aliases)
    .orderBy(asc(aliases.id))
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
    .orderBy(asc(seriesEdges.fromBangumiId), asc(seriesEdges.toBangumiId), asc(seriesEdges.relation))
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
    .orderBy(asc(catalogProvenance.id))
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
    .orderBy(asc(mediaAssets.pointId))
    .getSQL();
  return (await db.execute(statement)).rows;
}

/** SHA-256 hex digest of the given bytes (the fallback content hash). */
async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
