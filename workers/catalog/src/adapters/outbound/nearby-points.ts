/**
 * Outbound adapter for the nearby-points path (card CATALOG-3; moved onto the
 * Prisma data plane by #1628): the PostGIS read (`NearbyPointsPort`) and the
 * point-detail enrichment (`PointDetailsPort`).
 *
 * Both reads are served through the Prisma query builder and the request's
 * runtime ({@link CatalogPrisma}) — the Drizzle seam this adapter used to share
 * with the rest of the catalog now serves everything except the nearby path.
 * The PostGIS predicates and the ordering are composed from the geography
 * pack's typed operations, so the dialect parameterizes and binds them flatly.
 *
 * ONE metric, the spheroid (spec §4.11). Before #1628 the ordering and the
 * reported `distance_m` disagreed by accident: `location <-> point` is the
 * sphere while `ST_Distance(location, point)` defaults to `use_spheroid = true`,
 * and at Tokyo the two orderings disagree on the capped row set. Ordering and
 * reporting now use the same `ST_Distance` expression, so the `MAX_RESULTS` cap
 * keeps the rows the reported metric calls nearest.
 */

import { geographyPoint, type GeographyPoint } from "@animichi/prisma-geography";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type {
  NearbyPoint,
  NearbyPointsPort,
  PointDetail,
  PointDetailsPort,
} from "../../application/nearby-points";
import type { CatalogPrisma } from "../../db/prisma";

/** The geo columns the adapter selects; `distanceM` is meters. */
export interface NearbyRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceM: number;
}

/** Cap on returned points — the radius bounds the result, never a page count.
 * Exported because the cap only means anything alongside the ordering metric
 * (§4.11): a test asserting "the nearest N" has to name the N the query uses. */
export const MAX_RESULTS = 200;

/** Build the `NearbyPointsPort` backed by one request's Prisma runtime. */
export function nearbyGeoPort(query: CatalogPrisma): NearbyPointsPort {
  return { pointsWithin: (lat, lng, radiusM) => fetchNearby(query, lat, lng, radiusM) };
}

/** Points within `radiusM` meters of (lat, lng), nearest first by the reported metric. */
async function fetchNearby(
  query: CatalogPrisma,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<NearbyPoint[]> {
  const rows = await query.executor.query(nearbyPlan(query, geographyPoint(lng, lat), radiusM));
  return rows.map(toNearbyPoint);
}

/**
 * The geo plan: `ST_DWithin` radius filter, `ST_Distance` ordering, capped.
 *
 * The ordering expression is the same one the projection reports, and the
 * `id` tie-break keeps the order total, so the cap can never depend on
 * physical row order.
 */
function nearbyPlan(
  query: CatalogPrisma,
  point: GeographyPoint<4326>,
  radiusM: number,
): SqlOrmPlan<NearbyRow> {
  return query.builder.public.points
    .select("id", "name", "latitude", "longitude")
    .select("distanceM", (fields, operations) => operations.distanceMeters(fields.location, point))
    .where((fields, operations) => operations.dwithinMeters(fields.location, point, radiusM))
    .orderBy((fields, operations) => operations.distanceMeters(fields.location, point))
    .orderBy("id")
    .limit(MAX_RESULTS)
    .build();
}

/** Map a geo row to the port's `NearbyPoint` shape. */
function toNearbyPoint(row: NearbyRow): NearbyPoint {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceM: row.distanceM,
  };
}

/** Build the `PointDetailsPort` backed by one request's Prisma runtime. */
export function nearbyDetailsPort(query: CatalogPrisma): PointDetailsPort {
  return { detailsFor: (ids) => loadDetails(query, ids) };
}

/** The point detail columns for `ids`; no row means the caller keeps defaults. */
async function loadDetails(query: CatalogPrisma, ids: string[]): Promise<Map<string, PointDetail>> {
  if (ids.length === 0) return new Map();
  const rows = await query.executor.query(detailsPlan(query, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The detail IN-select: the columns the geo read omits, keyed by id. */
function detailsPlan(query: CatalogPrisma, ids: string[]): SqlOrmPlan<PointDetail> {
  return query.builder.public.points
    .select("id", "bangumi_id", "name_cn", "image", "episode", "time_seconds", "origin", "origin_url", "city")
    .where((fields, match) => match.in(fields.id, ids))
    .build();
}
