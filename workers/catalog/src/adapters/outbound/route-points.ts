/**
 * Outbound adapter for the `PointsForRoutePort`: fetch the points for a route
 * from Postgres (joined to bangumi for the anime title) and map the rows to
 * `ItineraryPoint`s, preserving the requested `ids` order. This adapter owns the
 * only SQL on the plan-itinerary path.
 */

import { sql } from "drizzle-orm";
import type { ItineraryPoint, PointsForRoutePort } from "../../application/plan-itinerary";
import { optional } from "../../lib/optional";
import type { Point } from "../../types";

/** The one DB capability this adapter needs: run a query, get back `{ rows }`. */
export interface RouteDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

/** One joined points+bangumi row, as selected by {@link pointsQuery}. */
interface PointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  origin: string | null;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
  city?: string | null;
}

/** Build the `PointsForRoutePort` backed by `db` (a single SELECT, no writes). */
export function pointsForRoute(db: RouteDb): PointsForRoutePort {
  return { loadPoints: (ids) => fetchPoints(db, ids) };
}

/** SELECT the points for `ids` joined to their bangumi, preserving `ids` order. */
async function fetchPoints(db: RouteDb, ids: string[]): Promise<ItineraryPoint[]> {
  if (ids.length === 0) return [];
  const result = await db.execute(pointsQuery(ids));
  const byId = indexRows(result.rows as PointRow[]);
  return ids.flatMap((id) => {
    const val = byId.get(id);
    return val ? [val] : [];
  });
}

/** Index fetched rows by `id` (mapped to points), for ordered reassembly. */
function indexRows(rows: PointRow[]): Map<string, ItineraryPoint> {
  return new Map(rows.map((r) => [r.id, toPoint(r)]));
}

/** The points+bangumi SELECT for `ids` (parameterised via `inArray`-style IN). */
function pointsQuery(ids: string[]) {
  return sql`
    SELECT p.id, p.name, p.name_cn, p.bangumi_id, p.episode, p.time_seconds,
           p.image, p.latitude, p.longitude, p.origin, p.city,
           b.title, b.title_cn, b.cover_url
    FROM points p
    LEFT JOIN bangumi b ON b.id = p.bangumi_id
    WHERE p.id IN (${sql.join(ids, sql`, `)})
  `;
}

/** Map a joined DB row to a contract `Point` (+ clustering geo). */
function toPoint(r: PointRow): ItineraryPoint {
  return { ...scalarFields(r), latitude: r.latitude, longitude: r.longitude };
}

/** The non-coordinate `Point` fields, dropping null optionals. */
function scalarFields(r: PointRow): Omit<Point, "latitude" | "longitude"> {
  return { ...scalarBase(r), ...optional(scalarOptionals(r)) };
}

function scalarBase(r: PointRow): Omit<Point, "latitude" | "longitude"> {
  return {
    id: r.id,
    name: r.name,
    bangumi_id: r.bangumi_id,
    screenshot_url: r.image ?? "",
  };
}

function scalarOptionals(r: PointRow): Record<string, unknown> {
  return {
    name_cn: r.name_cn, episode: r.episode, time_seconds: r.time_seconds,
    origin: r.origin, title: r.title, title_cn: r.title_cn,
    cover_url: r.cover_url, city: r.city,
  };
}
