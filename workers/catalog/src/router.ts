import { catalogContract } from "@seichijunrei/contract";
import { implement } from "@orpc/server";
import { search as searchHandler, searchDb } from "./api/search";
import { nearby as nearbyHandler } from "./api/nearby";
import { geocode as geocodeHandler } from "./api/geocode";
import { route as routeHandler } from "./api/route";
import { spots as spotsHandler, SpotNotFoundError } from "./api/spots";
import type { CatalogDb, NeonSql } from "./db/client";
import { ingestWork, type IngestResult as OrchestratorResult } from "./ingest/orchestrator";
import { routeTooManyPoints, workNotFound } from "./lib/errors";
import type { IngestResult, Origin } from "./types";

/** Per-request dependencies injected by the Hono boundary in `index.ts`. */
export interface CatalogContext {
  db: CatalogDb;
  neonSql: NeonSql;
  fetchImpl?: typeof fetch;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Implement the shared contract value directly. Its routes, Zod validators,
 * error maps, and output schemas are the Worker boundary's source of truth.
 */
const os = implement(catalogContract).$context<CatalogContext>();

const search = os.search.handler(async ({ input, context }) =>
  searchHandler(searchDb(context.db), input, {
    fetchImpl: context.fetchImpl,
    waitUntil: context.waitUntil,
  }),
);

const spots = os.spots.handler(async ({ input, context }) =>
  callSpots(context.db, input),
);

const nearby = os.nearby.handler(async ({ input, context }) =>
  nearbyHandler(context.db, context.neonSql, input),
);

const geocode = os.geocode.handler(async ({ input, context }) =>
  geocodeHandler(context.db, input),
);

const MAX_ROUTE_POINT_IDS = 500;

/** Reject route inputs over the point_ids cap with the typed 400. */
function assertRoutePointIdCap(count: number): Promise<void> {
  if (count > MAX_ROUTE_POINT_IDS) {
    return Promise.reject(routeTooManyPoints(count, MAX_ROUTE_POINT_IDS));
  }
  return Promise.resolve();
}

const route = os.route.handler(async ({ input, context }) => {
  await assertRoutePointIdCap(input.point_ids.length);
  return routeHandler(context.db, input);
});

const ingest = os.ingest.handler(async ({ input, context }) =>
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
    if (err instanceof SpotNotFoundError) throw workNotFound(err.bangumiId);
    throw err;
  }
}

export const catalogRouter = { search, spots, nearby, geocode, route, ingest };
export type CatalogRouter = typeof catalogRouter;
