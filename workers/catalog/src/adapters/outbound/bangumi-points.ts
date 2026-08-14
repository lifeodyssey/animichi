/**
 * Outbound adapter for the `PointsByBangumiPort`: ONE SELECT that reads a
 * Bangumi's published points (joined to bangumi for the anime title) in scene
 * order and maps each raw row to a validated `PublishedPointRow`. This adapter
 * owns the only SQL and the raw row mapping on the points-by-bangumi read path.
 *
 * The SELECT is built with the Drizzle query builder over the single seam and
 * run through `db.execute`, so the dialect parameterises the `bangumi_id`
 * bound and the ORDER BY defines "scene order".
 */
import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { PointsByBangumiPort, PublishedPointRow } from "../../application/list-points-for-bangumi";
import {
  nullableNumber, nullableString, nullableTimestamp, requiredNumber, requiredString,
} from "../../lib/rows";
import { statementBuilder } from "../../db/client";
import { bangumi, points } from "../../db/schema";

/** The one DB capability this adapter needs: run a query, get back `{ rows }`. */
export interface BangumiPointsDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

/** Build the `PointsByBangumiPort` backed by `db` (a single SELECT, no writes). */
export function bangumiPoints(db: BangumiPointsDb): PointsByBangumiPort {
  return { pointsForBangumi: (bangumiId) => selectPoints(db, bangumiId) };
}

/** SELECT the Bangumi's points joined to its title metadata, in scene order. */
async function selectPoints(db: BangumiPointsDb, bangumiId: string): Promise<PublishedPointRow[]> {
  const result = await db.execute(pointsForBangumiStatement(bangumiId));
  return result.rows.map(readPublishedPointRow);
}

/** The joined points+bangumi SELECT, ordered episode → time_seconds → id. */
function pointsForBangumiStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({
      id: points.id, name: points.name, nameCn: points.nameCn,
      bangumiId: points.bangumiId, episode: points.episode, timeSeconds: points.timeSeconds,
      image: points.image, latitude: points.latitude, longitude: points.longitude,
      city: points.city, title: bangumi.title, titleCn: bangumi.titleCn,
      coverUrl: bangumi.coverUrl, syncedAt: bangumi.updatedAt,
    })
    .from(points)
    .leftJoin(bangumi, eq(points.bangumiId, bangumi.id))
    .where(eq(points.bangumiId, bangumiId))
    .orderBy(asc(points.episode), asc(points.timeSeconds), asc(points.id))
    .getSQL();
}

/** Validate and coerce one raw joined row to a `PublishedPointRow`. */
function readPublishedPointRow(row: unknown): PublishedPointRow {
  if (row === null || typeof row !== "object") throw new Error("Catalog row is not an object");
  const r = row as Record<string, unknown>;
  return {
    id: requiredString(r, "id"), name: requiredString(r, "name"),
    name_cn: nullableString(r, "name_cn"), bangumi_id: nullableString(r, "bangumi_id"),
    episode: nullableNumber(r, "episode"), time_seconds: nullableNumber(r, "time_seconds"),
    image: nullableString(r, "image"), latitude: requiredNumber(r, "latitude"),
    longitude: requiredNumber(r, "longitude"),
    title: nullableString(r, "title"), title_cn: nullableString(r, "title_cn"),
    cover_url: nullableString(r, "cover_url"),
    city: nullableString(r, "city"), synced_at: nullableTimestamp(r, "synced_at"),
  };
}
