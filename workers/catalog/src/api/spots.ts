// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/**
 * Catalog `spots` read handler — one representative pilgrimage point for a work,
 * optionally annotated with `distance_m` from a caller-supplied origin.
 *
 * Shape source of truth: packages/contract/src/contract.ts ->
 *   spots(bangumi_id, origin?) -> { point: Point, distance_m? }
 * The contract returns a SINGLE point (not a list), so we pick the work's
 * representative point (lowest id, deterministic) and 404 if the work has none.
 *
 * Read-only. Since #1631 the read is a plan over the shared contract, built with
 * `query.builder.public.points` and executed on the caller's request runtime
 * ({@link CatalogPrisma}, spec §4.2) — see the plan builder below for why that
 * removes the row narrowing the Drizzle seam needed. The wire shapes (`Point` /
 * `Origin`) come from `../types` — the single in-Worker mirror of
 * packages/contract/src/models.ts (import type erases at compile time, keeping
 * the contract's zod runtime out of the bundle).
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { haversine } from "../domain/geo";
import { optional } from "../lib/optional";
import type { Origin, Point } from "../types";

export type { Origin, Point };

/** The representative read's columns, in the contract's own output types.
 *
 * The plan builder below is annotated with this, so the shape is CHECKED against
 * the contract-bound builder rather than asserted: dropping a column from the
 * plan, or giving one the wrong type here, is a compile error. The Drizzle path
 * could not do this — its rows arrived as `unknown[]`, so a hand-written
 * interface plus an `as unknown as` cast was the only way to name the columns,
 * and a drift between that interface and the SELECT was invisible to the
 * compiler. */
interface RepresentativeRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string | null;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  origin: string | null;
  origin_url: string | null;
}

/** Thrown when the work has no pilgrimage points to represent it. */
export class SpotNotFoundError extends Error {
  constructor(public readonly bangumiId: string) {
    super(`no pilgrimage points for bangumi_id=${bangumiId}`);
    this.name = "SpotNotFoundError";
  }
}

/** Representative point for a work (lowest id first for a stable pick). */
function representativePlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<RepresentativeRow> {
  return query.builder.public.points
    .select(
      "id", "name", "name_cn", "bangumi_id", "episode", "time_seconds",
      "image", "latitude", "longitude", "city", "origin", "origin_url",
    )
    .where((fields, match) => match.eq(fields.bangumi_id, bangumiId))
    .orderBy("id")
    .limit(1)
    .build();
}

/** Map a representative row to the contract Point shape (omitting null columns). */
function toPoint(r: RepresentativeRow): Point {
  return {
    ...pointBase(r),
    ...optional({ episode: r.episode, time_seconds: r.time_seconds }),
    ...(r.name_cn ? { name_cn: r.name_cn } : {}),
    ...(r.city ? { city: r.city } : {}),
    ...optional({ origin: r.origin, origin_url: r.origin_url }),
  };
}

function pointBase(r: RepresentativeRow): Point {
  return {
    id: r.id,
    name: r.name,
    bangumi_id: r.bangumi_id ?? "",
    screenshot_url: r.image ?? "",
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

/** Distance in meters from a lat/lng origin to the point; undefined for named origins. */
function distanceFrom(point: Point, origin?: Origin): number | undefined {
  if (!origin || typeof origin === "string") {
    return undefined;
  }
  return haversine(origin.lat, origin.lng, point.latitude, point.longitude);
}

/** Fetch the representative point for a work, with optional distance from origin. */
export async function spots(
  query: CatalogPrisma,
  input: { bangumi_id: string; origin?: Origin },
): Promise<{ point: Point; distance_m?: number }> {
  const [row] = await query.executor.query(representativePlan(query, input.bangumi_id));
  if (!row) throw new SpotNotFoundError(input.bangumi_id);
  const point = toPoint(row);
  const distance_m = distanceFrom(point, input.origin);
  return distance_m == null ? { point } : { point, distance_m };
}
