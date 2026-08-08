// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/**
 * The `planItinerary` read API handler: plan an ordered, timed itinerary over
 * selected points. Handler orchestration only — the SQL fetch lives in the
 * outbound adapter `adapters/outbound/route-points.ts` and the planning
 * orchestration in the use case `application/plan-itinerary.ts` (load points
 * via port -> cluster -> nearest-neighbor order -> timed itinerary -> contract
 * `Itinerary`).
 *
 * Read-only: a single SELECT, no writes.
 */

import { pointsForRoute, type RouteDb } from "../adapters/outbound/route-points";
import { planItinerary as planItineraryUseCase, type ItineraryInput } from "../application/plan-itinerary";
import type { Origin, Point, Itinerary } from "../types";

/**
 * Output types (`Point` / `Itinerary`) and the `Origin` input come from
 * `../types` — the single in-Worker mirror of `packages/contract/src/models.ts`.
 * `import type` erases at compile time, so the contract's zod runtime stays out
 * of the Worker bundle. Re-exported here so existing consumers keep importing
 * them from this handler.
 */
export type { Origin, Point, Itinerary };
export type { RouteDb, ItineraryInput };

/** Plan an ordered, timed itinerary over `point_ids`. Empty/unknown ids -> count 0. */
export function planItinerary(db: RouteDb, input: ItineraryInput): Promise<Itinerary> {
  return planItineraryUseCase(pointsForRoute(db), input);
}
