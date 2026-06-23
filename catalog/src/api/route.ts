/**
 * The `route` read API handler: plan an ordered, timed route over selected
 * points. Composes the data layer (fetch points + bangumi) with the pure W2-1
 * kernel (`catalog/src/lib/route.ts`: cluster -> nearest-neighbor order ->
 * timed itinerary) and assembles the contract `Route`
 * (`packages/contract/src/models.ts`).
 *
 * Flow: fetch points for `point_ids` (joined to bangumi for the anime title) ->
 * `clusterByLocation` (50m) -> `buildTimedItinerary` -> expand the ordered
 * clusters back to their member points (= `ordered_points`) -> `Route`.
 *
 * Read-only: a single SELECT, no writes. Origin is forwarded to the kernel only
 * in `{lat,lng}` form; the contract's named-place string Origin would need
 * geocoding first (a follow-up, alongside the `leg_cache` pre-warmed walk
 * durations the kernel currently derives from haversine).
 */

import { sql } from "drizzle-orm";
import type { ClusterablePoint, LocationCluster } from "../lib/clustering";
import { clusterByLocation } from "../lib/clustering";
import { optional } from "../lib/optional";
import type { Origin as KernelOrigin, Pacing, TimedItinerary } from "../lib/route";
import { buildTimedItinerary } from "../lib/route";
import type { Origin, PilgrimagePoint, Route } from "../types";

/**
 * Output types (`PilgrimagePoint` / `Route`) and the `Origin` / `Pacing` inputs
 * come from `../types` — the single in-Worker mirror of
 * `packages/contract/src/models.ts`. `import type` erases at compile time, so the
 * contract's zod runtime stays out of the Worker bundle. Re-exported here so
 * existing consumers keep importing them from this handler.
 */
export type { Origin, PilgrimagePoint, Route };

/** Inputs for {@link route} — mirrors `RouteInput` in the contract. */
export interface RouteInput {
  point_ids: string[];
  origin?: Origin;
  pacing?: Pacing;
}

/** The one DB capability `route` needs: run a query, get back `{ rows }`. */
export interface RouteDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

/** One joined points+bangumi row, as selected by {@link fetchPoints}. */
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
}

/** A `PilgrimagePoint` carrying the geo fields {@link clusterByLocation} needs. */
type ClusterablePilgrimagePoint = PilgrimagePoint & ClusterablePoint;

/** A cluster whose members are full pilgrimage points (for `ordered_points`). */
type PointCluster = LocationCluster<ClusterablePilgrimagePoint>;

/** Plan an ordered, timed route over `point_ids`. Empty/unknown ids -> count 0. */
export async function route(db: RouteDb, input: RouteInput): Promise<Route> {
  const points = await fetchPoints(db, input.point_ids);
  const clusters = clusterByLocation(points, 50);
  const itinerary = buildTimedItinerary(clusters, kernelOpts(input));
  return assembleRoute(clusters, itinerary);
}

/** SELECT the points for `ids` joined to their bangumi, preserving `ids` order. */
async function fetchPoints(db: RouteDb, ids: string[]): Promise<ClusterablePilgrimagePoint[]> {
  if (ids.length === 0) return [];
  const result = await db.execute(pointsQuery(ids));
  const byId = indexRows(result.rows as PointRow[]);
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Index fetched rows by `id` (mapped to points), for ordered reassembly. */
function indexRows(rows: PointRow[]): Map<string, ClusterablePilgrimagePoint> {
  return new Map(rows.map((r) => [r.id, toPoint(r)]));
}

/** The points+bangumi SELECT for `ids` (parameterised via `inArray`-style IN). */
function pointsQuery(ids: string[]) {
  return sql`
    SELECT p.id, p.name, p.name_cn, p.bangumi_id, p.episode, p.time_seconds,
           p.image, p.latitude, p.longitude, p.origin,
           b.title, b.title_cn, b.cover_url
    FROM points p
    LEFT JOIN bangumi b ON b.id = p.bangumi_id
    WHERE p.id IN (${sql.join(ids, sql`, `)})
  `;
}

/** Map a joined DB row to a contract `PilgrimagePoint` (+ clustering geo). */
function toPoint(r: PointRow): ClusterablePilgrimagePoint {
  return {
    ...scalarFields(r),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  };
}

/** The non-coordinate `PilgrimagePoint` fields, dropping null optionals. */
function scalarFields(r: PointRow): Omit<PilgrimagePoint, "latitude" | "longitude"> {
  return {
    id: r.id,
    name: r.name,
    bangumi_id: r.bangumi_id,
    screenshot_url: r.image ?? "",
    ...optional({
      name_cn: r.name_cn,
      episode: r.episode,
      time_seconds: r.time_seconds,
      origin: r.origin,
      title: r.title,
      title_cn: r.title_cn,
      cover_url: r.cover_url,
    }),
  };
}

/** Kernel itinerary options: pacing + the coordinate form of Origin only. */
function kernelOpts(input: RouteInput): { pacing?: Pacing; origin?: KernelOrigin } {
  const origin = typeof input.origin === "object" ? input.origin : undefined;
  return { pacing: input.pacing, origin };
}

/** Assemble the contract `Route` from the ordered clusters and the itinerary. */
function assembleRoute(clusters: PointCluster[], itinerary: TimedItinerary): Route {
  const ordered = orderPoints(clusters, itinerary);
  return { ...animeMeta(ordered[0]), ordered_points: ordered, point_count: ordered.length, timed_itinerary: itinerary };
}

/** Expand the itinerary's ordered stops back to their member points, in order. */
function orderPoints(clusters: PointCluster[], itinerary: TimedItinerary): PilgrimagePoint[] {
  const byCluster = new Map(clusters.map((c) => [c.clusterId, c]));
  return itinerary.stops.flatMap((s) => byCluster.get(s.cluster_id)?.points ?? []);
}

/** The anime-title metadata carried on the Route, taken from the lead point. */
function animeMeta(lead?: PilgrimagePoint): Pick<Route, "anime_title" | "anime_title_cn" | "cover_url"> {
  return optional({
    anime_title: lead?.title,
    anime_title_cn: lead?.title_cn,
    cover_url: lead?.cover_url,
  });
}
