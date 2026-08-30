import { catalogContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import { resolveBangumi, type ResolveObserverPort } from "./application/resolve-bangumi";
import { planItinerary as planItineraryUseCase, type ItineraryObserverPort } from "./application/plan-itinerary";
import { bangumiTitleSearch } from "./adapters/outbound/bangumi-search";
import { titleAlias } from "./adapters/outbound/title-alias";
import { pointsForRoute } from "./adapters/outbound/route-points";
import { search as searchHandler, searchDb } from "./api/search";
import { pointsByBangumiId, workPointsDb } from "./api/work-points";
import { nearby as nearbyHandler } from "./api/nearby";
import { geocode as geocodeHandler } from "./api/geocode";
import { spots as spotsHandler, SpotNotFoundError } from "./api/spots";
import { overviewPointsDb } from "./adapters/outbound/overview-points";
import { popularBangumiDb } from "./adapters/outbound/popular-bangumi";
import { AnimeOverviewNotFoundError, getBangumiOverview } from "./application/get-bangumi-overview";
import type { CatalogDb } from "./db/client";
import { routeTooManyPoints, workNotFound } from "./lib/errors";
import type { Origin } from "./types";

/** Per-request dependencies injected by the Hono boundary in `index.ts`. */
export interface CatalogContext {
  db: CatalogDb;
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

const resolve = os.resolve.handler(async ({ input, context }) =>
  resolveBangumi(titleAlias(context.db), bangumiTitleSearch({ fetchImpl: context.fetchImpl }), input, {
    observer: resolveObserver(),
  }),
);

const pointsById = os.pointsByBangumiId.handler(async ({ input, context }) =>
  pointsByBangumiId(workPointsDb(context.db), input.bangumi_id, {
    fetchImpl: context.fetchImpl,
  }),
);

const spots = os.spots.handler(async ({ input, context }) =>
  callSpots(context.db, input),
);

const nearby = os.nearby.handler(async ({ input, context }) =>
  nearbyHandler(context.db, input),
);

const geocode = os.geocode.handler(async ({ input, context }) =>
  geocodeHandler(context.db, input),
);

const MAX_ITINERARY_POINT_IDS = 500;

/** Reject itinerary inputs over the point_ids cap with the typed 400. */
function assertItineraryPointIdCap(count: number): Promise<void> {
  if (count > MAX_ITINERARY_POINT_IDS) {
    return Promise.reject(routeTooManyPoints(count, MAX_ITINERARY_POINT_IDS));
  }
  return Promise.resolve();
}

const planItinerary = os.planItinerary.handler(async ({ input, context }) => {
  await assertItineraryPointIdCap(input.point_ids.length);
  return planItineraryUseCase(pointsForRoute(context.db), input, {
    observer: itineraryObserver(),
  });
});

const animeOverview = os.animeOverview.handler(async ({ input, context }) =>
  callAnimeOverview(context.db, input),
);

const popular = os.popular.handler(async ({ input, context }) => {
  const rows = await popularBangumiDb(context.db).listPopular(input.limit);
  return {
    bangumi: rows.map((row) => ({
      bangumi_id: row.id,
      title: row.title,
      title_cn: row.title_cn,
      cover_url: row.cover_url,
      city: row.city,
      points_count: row.points_count,
      rating: row.rating,
    })),
  };
});

/** Run `spots`, translating a no-points work into an oRPC 404 (else 500). */
async function callSpots(db: CatalogDb, input: { bangumi_id: string; origin?: Origin }) {
  try {
    return await spotsHandler(db, input);
  } catch (err) {
    if (err instanceof SpotNotFoundError) throw workNotFound(err.bangumiId);
    throw err;
  }
}

/** Run anime overview, translating only an absent anime into the typed 404. */
async function callAnimeOverview(db: CatalogDb, input: { bangumi_id: string }) {
  try {
    return await getBangumiOverview(overviewPointsDb(db), input);
  } catch (err) {
    if (err instanceof AnimeOverviewNotFoundError) throw workNotFound(err.bangumiId);
    throw err;
  }
}

/** Redacted resolve observability: outcome, candidate count, source class, duration. */
function resolveObserver(): ResolveObserverPort {
  return {
    record: (o) => {
      console.info(
        `resolve outcome=${o.outcome} candidates=${String(o.candidate_count)} source=${o.source_class} duration_ms=${String(o.duration_ms)}`,
      );
    },
  };
}

/** Redacted itinerary observability: outcome, counts, truncation, duration. Never coordinates/titles. */
function itineraryObserver(): ItineraryObserverPort {
  return {
    record: (o) => {
      console.info(
        `plan-itinerary outcome=${o.outcome} point_count=${String(o.point_count)} cluster_count=${String(o.cluster_count)} truncated=${String(o.truncated)} duration_ms=${String(o.duration_ms)}`,
      );
    },
  };
}

export const catalogRouter = {
  search,
  resolve,
  pointsByBangumiId: pointsById,
  spots,
  nearby,
  geocode,
  planItinerary,
  animeOverview,
  popular,
};
export type CatalogRouter = typeof catalogRouter;
