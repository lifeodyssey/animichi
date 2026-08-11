/**
 * Outbound adapter for the `PointsByBangumiPort`: ONE SELECT that reads a
 * Bangumi's published points (joined to bangumi for the anime title) in scene
 * order and maps each raw row to a validated `PublishedPointRow`. This adapter
 * owns the only SQL and the raw row mapping on the points-by-bangumi read path.
 */

import { sql } from "drizzle-orm";
import type { PointsByBangumiPort, PublishedPointRow } from "../../application/list-points-for-bangumi";
import {
  nullableNumber, nullableString, nullableTimestamp, requiredNumber, requiredString,
} from "../../lib/rows";

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
  const result = await db.execute(sql`
    SELECT p.id, p.name, p.name_cn, p.bangumi_id, p.episode, p.time_seconds,
           p.image, p.latitude, p.longitude, p.city, b.title, b.title_cn,
           b.cover_url, b.updated_at AS synced_at
    FROM points p LEFT JOIN bangumi b ON p.bangumi_id = b.id
    WHERE p.bangumi_id = ${bangumiId}
    ORDER BY p.episode ASC, p.time_seconds ASC, p.id ASC
  `);
  return result.rows.map(readPublishedPointRow);
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
