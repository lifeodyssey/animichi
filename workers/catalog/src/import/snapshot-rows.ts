/**
 * A published snapshot's rows, as the plane's columns (#1633).
 *
 * The import is the inverse of `../publish/candidate-export`: that module
 * projects each public table under the snapshot's OWN keys — camelCase, because
 * a projection's alias is the key the exported JSON carries — and this module
 * reads those keys back into the column names the table declares.
 *
 * The pairing is stated key by key rather than derived by case conversion. A
 * conversion would accept a key the export never emits, and it would have
 * nothing to say about the two places the two shapes genuinely differ:
 *
 *   - `points.latitude` / `longitude` are GENERATED over `location` on this
 *     plane, so the exported pair is written back as the geography it was read
 *     from. Writing the scalars is `cannot insert a non-DEFAULT value into
 *     column "latitude"` (`428C9`).
 *   - `catalog_provenance.attribution` / `field_map` are jsonb, which the plan
 *     boundary takes as `JsonValue` (see `../lib/json`).
 *
 * Each row is read through its snapshot interface after `importSnapshot` has
 * verified the object's SHA-256 against the manifest, so what arrives here is
 * bytes this Worker's own export wrote, not caller input.
 */
import { geographyPoint } from "@animichi/prisma-geography";
import { asJsonValue } from "../lib/json";
import type { ImportKind } from "./import-snapshot";

/** The public table each snapshot kind loads (staging's active Catalog). */
export const TABLE_BY_KIND = {
  works: "bangumi",
  points: "points",
  aliases: "aliases",
  series: "series_edges",
  provenance: "catalog_provenance",
  media: "media_assets",
} as const satisfies Record<ImportKind, string>;

/** The `bangumi` row as `worksPlan` exported it. */
interface SnapshotWork {
  id: string; title: string; titleCn: string | null; coverUrl: string | null;
  airDate: string | null; summary: string | null; epsCount: number | null;
  rating: number | null; pointsCount: number | null; primaryColor: string | null;
  city: string | null; platform: string | null; updatedAt: string | null;
}

/** The `points` row as `pointsPlan` exported it (coordinates, not geography). */
interface SnapshotPoint {
  id: string; bangumiId: string | null; name: string; nameCn: string | null;
  latitude: number; longitude: number; image: string | null; episode: number | null;
  timeSeconds: number | null; sceneDesc: string | null; origin: string | null;
  originUrl: string | null; city: string | null;
}

/** The `aliases` row as `aliasesPlan` exported it. */
interface SnapshotAlias {
  bangumiId: string; alias: string; aliasNormalized: string; source: string; priority: number;
}

/** The `series_edges` row as `seriesPlan` exported it. */
interface SnapshotSeriesEdge {
  fromBangumiId: string; toBangumiId: string; relation: string;
}

/** The `catalog_provenance` row as `provenancePlan` exported it. */
interface SnapshotProvenance {
  scope: string; entityId: string; workId: string | null; source: string;
  upstreamId: string | null; attribution: object | null; license: string | null;
  fieldMap: object | null; capturedAt: string | null;
}

/** The `media_assets` row as `mediaPlan` exported it. */
interface SnapshotMediaAsset {
  pointId: string; r2Key: string | null; contentHash: string | null; tombstoned: boolean;
}

/** One `bangumi` row, under the column names the table declares. */
function bangumiColumns(row: SnapshotWork) {
  return {
    id: row.id, title: row.title, title_cn: row.titleCn, cover_url: row.coverUrl,
    air_date: row.airDate, summary: row.summary, eps_count: row.epsCount,
    rating: row.rating, points_count: row.pointsCount, primary_color: row.primaryColor,
    city: row.city, platform: row.platform, updated_at: row.updatedAt,
  };
}

/** One `points` row, with the exported coordinates back as the geography. */
function pointColumns(row: SnapshotPoint) {
  return {
    id: row.id, bangumi_id: row.bangumiId, name: row.name, name_cn: row.nameCn,
    location: geographyPoint(row.longitude, row.latitude), image: row.image,
    episode: row.episode, time_seconds: row.timeSeconds, scene_desc: row.sceneDesc,
    origin: row.origin, origin_url: row.originUrl, city: row.city,
  };
}

/** One `aliases` row, under the column names the table declares. */
function aliasColumns(row: SnapshotAlias) {
  return {
    bangumi_id: row.bangumiId, alias: row.alias, alias_normalized: row.aliasNormalized,
    source: row.source, priority: row.priority,
  };
}

/** One `series_edges` row, under the column names the table declares. */
function seriesEdgeColumns(row: SnapshotSeriesEdge) {
  return {
    from_bangumi_id: row.fromBangumiId, to_bangumi_id: row.toBangumiId, relation: row.relation,
  };
}

/** One `catalog_provenance` row; its two jsonb columns cross the plan boundary. */
function provenanceColumns(row: SnapshotProvenance) {
  return {
    scope: row.scope, entity_id: row.entityId, work_id: row.workId, source: row.source,
    upstream_id: row.upstreamId, attribution: jsonOrNull(row.attribution),
    license: row.license, field_map: jsonOrNull(row.fieldMap), captured_at: row.capturedAt,
  };
}

/** One `media_assets` row, under the column names the table declares. */
function mediaAssetColumns(row: SnapshotMediaAsset) {
  return {
    point_id: row.pointId, r2_key: row.r2Key,
    content_hash: row.contentHash, tombstoned: row.tombstoned,
  };
}

/** A jsonb column's value, keeping an absent one absent. */
function jsonOrNull(value: object | null) {
  return value === null ? null : asJsonValue(value);
}

/** Every kind's reader, keyed by the kind whose rows it reads. */
const COLUMNS_BY_KIND = {
  works: (row: unknown) => bangumiColumns(row as SnapshotWork),
  points: (row: unknown) => pointColumns(row as SnapshotPoint),
  aliases: (row: unknown) => aliasColumns(row as SnapshotAlias),
  series: (row: unknown) => seriesEdgeColumns(row as SnapshotSeriesEdge),
  provenance: (row: unknown) => provenanceColumns(row as SnapshotProvenance),
  media: (row: unknown) => mediaAssetColumns(row as SnapshotMediaAsset),
} as const satisfies Record<ImportKind, (row: unknown) => object>;

/** One kind's exported rows, as the values its table's INSERT takes. */
export function tableRows(kind: ImportKind, rows: readonly unknown[]): object[] {
  const columnsOf = COLUMNS_BY_KIND[kind];
  return rows.map((row) => columnsOf(row));
}
