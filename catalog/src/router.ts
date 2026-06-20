import { ORPCError, os, type } from "@orpc/server";
import type { CatalogDb } from "./db/client";
import { search as searchHandler, searchDb } from "./api/search";
import { spots as spotsHandler, SpotNotFoundError } from "./api/spots";
import { nearby as nearbyHandler } from "./api/nearby";
import { route as routeHandler } from "./api/route";
import type { Origin, Pacing } from "./types";

/**
 * Catalog oRPC router — the 4 read methods wired to their real handlers.
 *
 * Served via `OpenAPIHandler` (see `index.ts`), so requests and responses are
 * PLAIN JSON matching `packages/contract/openapi.json` and the Python
 * `CatalogClient`: a POST body of `{query}` / `{bangumi_id}` / `{lat,lng,radius_m}`
 * / `{point_ids}`, and a top-level `{rows, synced_at}` / `{point, distance_m?}` /
 * `Route` response (NOT the `{json: ...}` envelope the RPCHandler used).
 *
 * Each procedure declares `.route({method:"POST", path:"/<method>"})`; mounted
 * under the `/catalog` prefix this yields the contract paths `/catalog/search`,
 * `/catalog/spots`, `/catalog/nearby`, `/catalog/route`.
 *
 * Each procedure reads the per-request `db` from the oRPC context (set in
 * `index.ts` from the Hyperdrive/DATABASE_URL connection) and delegates to the
 * committed `src/api/*` handlers, which run the Drizzle + PostGIS queries.
 *
 * `type<T>()` is oRPC's built-in passthrough validator — it gives typed inputs
 * without pulling the contract's zod schemas into the Worker bundle. The input
 * shapes below MUST stay in lockstep with packages/contract/src.
 */

/** Per-request oRPC context: the Drizzle client for this invocation. */
export interface CatalogContext {
  db: CatalogDb;
}

/** Base builder carrying the Catalog context so handlers can read `context.db`. */
const base = os.$context<CatalogContext>();

/** search(query, origin?) -> { rows, synced_at } */
const search = base
  .route({ method: "POST", path: "/search" })
  .input(type<{ query: string; origin?: Origin }>())
  .handler(async ({ input, context }) => searchHandler(searchDb(context.db), input));

/** spots(bangumi_id, origin?) -> { point, distance_m? }; missing work -> 404. */
const spots = base
  .route({ method: "POST", path: "/spots" })
  .input(type<{ bangumi_id: string; origin?: Origin }>())
  .handler(async ({ input, context }) => callSpots(context.db, input));

/** nearby(lat, lng, radius_m) -> { rows } */
const nearby = base
  .route({ method: "POST", path: "/nearby" })
  .input(type<{ lat: number; lng: number; radius_m: number }>())
  .handler(async ({ input, context }) => nearbyHandler(context.db, input));

/** route(point_ids, origin?, pacing?) -> Route */
const route = base
  .route({ method: "POST", path: "/route" })
  .input(type<{ point_ids: string[]; origin?: Origin; pacing?: Pacing }>())
  .handler(async ({ input, context }) => routeHandler(context.db, input));

/** Run `spots`, translating a no-points work into an oRPC 404 (else 500). */
async function callSpots(db: CatalogDb, input: { bangumi_id: string; origin?: Origin }) {
  try {
    return await spotsHandler(db, input);
  } catch (err) {
    if (err instanceof SpotNotFoundError) throw new ORPCError("NOT_FOUND", { message: err.message });
    throw err;
  }
}

export const catalogRouter = { search, spots, nearby, route };

export type CatalogRouter = typeof catalogRouter;
