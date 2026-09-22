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
 * Statements are builder plans over the shared contract, run on the request's
 * runtime ({@link CatalogPrisma}). A projection's alias IS the key the row
 * carries into the exported JSON, and the aliases here are the snapshot's own
 * keys (`titleCn`, `coverUrl`, `bangumiId`, …) — the shape every reader of a
 * published snapshot already has, not a rename.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { jsonToArrayBuffer } from "./bytes";

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
 * The exported point row, as `pointsPlan` projects it. The plan carries this
 * type, so the exported points object has exactly these fields under these
 * names — the ones a published snapshot's readers already use.
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
export async function exportCandidate(query: CatalogPrisma, keyPrefix: string): Promise<CandidateExport> {
  return candidateFromRows(await readPublicRows(query), keyPrefix);
}

/** Read every public table's rows (ungated candidate material). */
export async function readPublicRows(query: CatalogPrisma): Promise<PublicRows> {
  return {
    works: await readWorks(query),
    points: await readPoints(query),
    aliases: await readAliases(query),
    series: await readSeries(query),
    provenance: await readProvenance(query),
    media: await readMedia(query),
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

async function readWorks(query: CatalogPrisma): Promise<readonly unknown[]> {
  return query.executor.query(worksPlan(query));
}

/** The work row: the public `bangumi` columns the snapshot has always carried. */
function worksPlan(query: CatalogPrisma): SqlOrmPlan {
  return query.builder.public.bangumi
    .select((fields) => ({
      id: fields.id, title: fields.title, titleCn: fields.title_cn, coverUrl: fields.cover_url,
      airDate: fields.air_date, summary: fields.summary, epsCount: fields.eps_count,
      rating: fields.rating, pointsCount: fields.points_count, primaryColor: fields.primary_color,
      city: fields.city, platform: fields.platform, updatedAt: fields.updated_at,
    }))
    .orderBy("id")
    .build();
}

async function readPoints(query: CatalogPrisma): Promise<readonly ExportedSpotRow[]> {
  return query.executor.query(pointsPlan(query));
}

/** The spot row: `latitude`/`longitude` are generated columns on this plane, and read back here. */
function pointsPlan(query: CatalogPrisma): SqlOrmPlan<ExportedSpotRow> {
  return query.builder.public.points
    .select((fields) => ({
      id: fields.id, bangumiId: fields.bangumi_id, name: fields.name, nameCn: fields.name_cn,
      latitude: fields.latitude, longitude: fields.longitude, image: fields.image,
      episode: fields.episode, timeSeconds: fields.time_seconds, sceneDesc: fields.scene_desc,
      origin: fields.origin, originUrl: fields.origin_url, city: fields.city,
    }))
    .orderBy("id")
    .build();
}

async function readAliases(query: CatalogPrisma): Promise<readonly unknown[]> {
  return query.executor.query(aliasesPlan(query));
}

/** The alias row, ordered by the id the export never carries. */
function aliasesPlan(query: CatalogPrisma): SqlOrmPlan {
  return query.builder.public.aliases
    .select((fields) => ({
      bangumiId: fields.bangumi_id, alias: fields.alias,
      aliasNormalized: fields.alias_normalized, source: fields.source, priority: fields.priority,
    }))
    .orderBy("id")
    .build();
}

async function readSeries(query: CatalogPrisma): Promise<readonly unknown[]> {
  return query.executor.query(seriesPlan(query));
}

/** The series edge row; the composite key is the export's order. */
function seriesPlan(query: CatalogPrisma): SqlOrmPlan {
  return query.builder.public.series_edges
    .select((fields) => ({
      fromBangumiId: fields.from_bangumi_id,
      toBangumiId: fields.to_bangumi_id,
      relation: fields.relation,
    }))
    .orderBy("from_bangumi_id")
    .orderBy("to_bangumi_id")
    .orderBy("relation")
    .build();
}

async function readProvenance(query: CatalogPrisma): Promise<readonly unknown[]> {
  return query.executor.query(provenancePlan(query));
}

/** The provenance row: the source map every exported work and spot is attributed by. */
function provenancePlan(query: CatalogPrisma): SqlOrmPlan {
  return query.builder.public.catalog_provenance
    .select((fields) => ({
      scope: fields.scope, entityId: fields.entity_id, workId: fields.work_id,
      source: fields.source, upstreamId: fields.upstream_id, attribution: fields.attribution,
      license: fields.license, fieldMap: fields.field_map, capturedAt: fields.captured_at,
    }))
    .orderBy("id")
    .build();
}

async function readMedia(query: CatalogPrisma): Promise<readonly unknown[]> {
  return query.executor.query(mediaPlan(query));
}

/** The media-asset row, one per point, ordered by that point. */
function mediaPlan(query: CatalogPrisma): SqlOrmPlan {
  return query.builder.public.media_assets
    .select((fields) => ({
      pointId: fields.point_id, r2Key: fields.r2_key,
      contentHash: fields.content_hash, tombstoned: fields.tombstoned,
    }))
    .orderBy("point_id")
    .build();
}

/** SHA-256 hex digest of the given bytes (the fallback content hash). */
async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
