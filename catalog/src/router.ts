import { ORPCError, os, type } from "@orpc/server";
import type { CatalogDb } from "./db/client";
import { search as searchHandler, searchDb } from "./api/search";
import { spots as spotsHandler, SpotNotFoundError } from "./api/spots";
import { nearby as nearbyHandler } from "./api/nearby";
import { route as routeHandler } from "./api/route";
import { ingestWork, type IngestResult as OrchestratorResult } from "./ingest/orchestrator";
import type { IngestResult, Origin, Pacing } from "./types";

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

/**
 * Per-request oRPC context: the Drizzle client for this invocation, plus the
 * `fetch` the `ingest` method uses to reach upstream Anitabi/Bangumi. `index.ts`
 * injects the real global `fetch` in prod; tests inject a stub so ingest never
 * hits the network. Defaults to global `fetch` when omitted.
 *
 * `waitUntil` is the Worker `ExecutionContext.waitUntil` (bound per request in
 * `index.ts`): it extends the request's lifetime so a backgrounded promise
 * (the search miss path's FULL ingest) runs to completion AFTER the response is
 * sent — instead of blocking it past the workerd request limit. Optional: when
 * absent (tests, older callers) the search path falls back to running the full
 * ingest synchronously.
 */
export interface CatalogContext {
  db: CatalogDb;
  fetchImpl?: typeof fetch;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Base builder carrying the Catalog context so handlers can read `context.db`. */
const base = os.$context<CatalogContext>();

/** search(query, origin?) -> { rows, synced_at, partial? }; an alias miss returns
 * an L1 preview and backgrounds the full ingest via `context.waitUntil`. */
const search = base
  .route({ method: "POST", path: "/search" })
  .input(type<{ query: string; origin?: Origin }>())
  .handler(async ({ input, context }) =>
    searchHandler(searchDb(context.db), input, {
      fetchImpl: context.fetchImpl,
      waitUntil: context.waitUntil,
    }),
  );

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

const MAX_ROUTE_POINT_IDS = 500;

/** route(point_ids, origin?, pacing?) -> Route */
const route = base
  .route({ method: "POST", path: "/route" })
  .input(type<{ point_ids: string[]; origin?: Origin; pacing?: Pacing }>())
  .handler(async ({ input, context }) => {
    if (input.point_ids.length > MAX_ROUTE_POINT_IDS) {
      throw new ORPCError("BAD_REQUEST", {
        message: `point_ids length ${input.point_ids.length} exceeds maximum of ${MAX_ROUTE_POINT_IDS}`,
      });
    }
    return routeHandler(context.db, input);
  });

/** ingest(bangumi_id) -> IngestResult; fetch-and-publish a not-yet-cataloged work. */
const ingest = base
  .route({ method: "POST", path: "/ingest" })
  .input(type<{ bangumi_id: string }>())
  .handler(async ({ input, context }) =>
    toIngestResult(
      await ingestWork(context.db, input.bangumi_id, { fetchImpl: context.fetchImpl }),
    ),
  );

/** Map the orchestrator union (camelCase) onto the snake_case wire shape. */
function toIngestResult(result: OrchestratorResult): IngestResult {
  if (result.status === "ingested") {
    return { status: "ingested", version: result.version, point_count: result.pointCount };
  }
  if (result.status === "in_progress") return { status: "in_progress" };
  return { status: result.status, reason: result.reason };
}

/** Run `spots`, translating a no-points work into an oRPC 404 (else 500). */
async function callSpots(db: CatalogDb, input: { bangumi_id: string; origin?: Origin }) {
  try {
    return await spotsHandler(db, input);
  } catch (err) {
    if (err instanceof SpotNotFoundError) throw new ORPCError("NOT_FOUND", { message: err.message });
    throw err;
  }
}

export const catalogRouter = { search, spots, nearby, route, ingest };

export type CatalogRouter = typeof catalogRouter;
