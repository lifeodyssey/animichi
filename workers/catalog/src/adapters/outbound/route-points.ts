/**
 * Outbound adapter for the `PointsForRoutePort`: fetch the points for a route
 * from Postgres (joined to bangumi for the anime title) and map the rows to
 * `ItineraryPoint`s, preserving the requested `ids` order. This adapter owns the
 * only SQL on the plan-itinerary path, built with the shared contract's
 * statement builder and run on the request's runtime ({@link CatalogPrisma}).
 *
 * The join is `outerLeftJoin` — a point with no bangumi row still routes, with a
 * NULL title, as it did under the Drizzle `leftJoin`. The row type is the plan's
 * own projection, so the `result.rows as PointRow[]` cast the Drizzle path used
 * to assert a shape the driver had already discarded is gone rather than ported
 * (§4.2).
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { ItineraryPoint, PointsForRoutePort } from "../../application/plan-itinerary";
import { optional } from "../../lib/optional";
import type { Point } from "../../types";
import type { CatalogPrisma } from "../../db/prisma";

/**
 * One joined points+bangumi row, as the plan projects it. An `interface`, not a
 * type alias, on purpose: the plan already hands back exactly this shape, and an
 * interface keeps the deleted row-narrowing helpers (`src/lib/rows.ts`) from
 * being called on it again — TypeScript refuses to pass one to their
 * `Record<string, unknown>` parameter.
 */
export interface ItineraryPointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string | null;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  origin: string | null;
  origin_url: string | null;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
  city: string | null;
}

/** Build the `PointsForRoutePort` on one request's Prisma runtime (one SELECT, no writes). */
export function pointsForRoute(query: CatalogPrisma): PointsForRoutePort {
  return { loadPoints: (ids) => fetchPoints(query, ids) };
}

/** SELECT the points for `ids` joined to their bangumi, preserving `ids` order. */
async function fetchPoints(query: CatalogPrisma, ids: string[]): Promise<ItineraryPoint[]> {
  if (ids.length === 0) return [];
  const byId = indexRows(await query.executor.query(pointsPlan(query, ids)));
  return ids.flatMap((id) => {
    const val = byId.get(id);
    return val ? [val] : [];
  });
}

/** Index fetched rows by `id` (mapped to points), for ordered reassembly. */
function indexRows(rows: readonly ItineraryPointRow[]): Map<string, ItineraryPoint> {
  return new Map(rows.map((row) => [row.id, toPoint(row)]));
}

/** The points+bangumi SELECT for `ids` (IN-set parameterised by the dialect). */
function pointsPlan(query: CatalogPrisma, ids: string[]): SqlOrmPlan<ItineraryPointRow> {
  return query.builder.public.points
    .outerLeftJoin(query.builder.public.bangumi, (fields, match) =>
      match.eq(fields.bangumi.id, fields.points.bangumi_id))
    .select((fields) => ({
      id: fields.points.id,
      name: fields.points.name,
      name_cn: fields.points.name_cn,
      bangumi_id: fields.points.bangumi_id,
      episode: fields.points.episode,
      time_seconds: fields.points.time_seconds,
      image: fields.points.image,
      latitude: fields.points.latitude,
      longitude: fields.points.longitude,
      origin: fields.points.origin,
      origin_url: fields.points.origin_url,
      city: fields.points.city,
      title: fields.bangumi.title,
      title_cn: fields.bangumi.title_cn,
      cover_url: fields.bangumi.cover_url,
    }))
    .where((fields, match) => match.in(fields.points.id, ids))
    .build();
}

/** Map a joined DB row to a contract `Point` (+ clustering geo). */
function toPoint(row: ItineraryPointRow): ItineraryPoint {
  return { ...scalarFields(row), latitude: row.latitude, longitude: row.longitude };
}

/** The non-coordinate `Point` fields, dropping null optionals. */
function scalarFields(row: ItineraryPointRow): Omit<Point, "latitude" | "longitude"> {
  return { ...scalarBase(row), ...optional(scalarOptionals(row)) };
}

function scalarBase(row: ItineraryPointRow): Omit<Point, "latitude" | "longitude"> {
  return {
    id: row.id,
    name: row.name,
    bangumi_id: row.bangumi_id ?? "",
    screenshot_url: row.image ?? "",
  };
}

function scalarOptionals(row: ItineraryPointRow): Record<string, unknown> {
  return {
    name_cn: row.name_cn, episode: row.episode, time_seconds: row.time_seconds,
    origin: row.origin, origin_url: row.origin_url, title: row.title, title_cn: row.title_cn,
    cover_url: row.cover_url, city: row.city,
  };
}
