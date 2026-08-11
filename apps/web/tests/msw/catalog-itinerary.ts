import { http } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import type { z } from "zod";
import { Itinerary as ItinerarySchema, ItineraryInput } from "@animichi/contract";
import { contractJsonHandler, orpcErrorResponse } from "./contract-handler";
import { CATALOG_ITINERARY_URL, plannedItineraryFixture } from "./fixtures";

/**
 * Contract-typed MSW swimlane for `catalog.planItinerary` (POST). The route
 * detail read journey calls this to hydrate the itinerary. The empty-points
 * body resolves to a zero-stop itinerary, mirroring the live use case.
 */
export const catalogPlanItineraryHandler: HttpHandler = contractJsonHandler({
  method: "post",
  url: CATALOG_ITINERARY_URL,
  input: ItineraryInput,
  output: ItinerarySchema,
  resolve: (input) =>
    input.point_ids.length === 0
      ? {
          ordered_points: [],
          point_count: 0,
          timed_itinerary: { stops: [], legs: [], total_minutes: 0, total_distance_m: 0 },
        }
      : plannedItineraryFixture,
});

/** An always-failing handler for the itinerary-error path. */
export const catalogItineraryOutageHandler: HttpHandler = http.post(CATALOG_ITINERARY_URL, () =>
  orpcErrorResponse({ code: "UPSTREAM_UNAVAILABLE", status: 502, message: "catalog unavailable" }),
);

/** A handler that orders the planned stops exactly as the route's point ids. */
export function catalogItineraryWithOrder(ids: readonly string[]): HttpHandler {
  return contractJsonHandler({
    method: "post",
    url: CATALOG_ITINERARY_URL,
    input: ItineraryInput,
    output: ItinerarySchema,
    resolve: (input) =>
      samePointIds(input.point_ids, ids)
        ? itineraryBody(ids)
        : orpcErrorResponse({ code: "BAD_REQUEST", status: 400, message: "point_ids do not match the configured itinerary" }),
  });
}

/** True when the request's point ids match the configured sequence exactly. */
function samePointIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((id, index) => actual[index] === id);
}

function itineraryBody(ids: readonly string[]): z.infer<typeof ItinerarySchema> {
  return {
    ordered_points: ids.map((id, index) => orderedPoint(id, index)),
    point_count: ids.length,
    timed_itinerary: {
      stops: ids.map((id, index) => ({
        cluster_id: id,
        name: `Stop ${String(index + 1)}`,
        arrive: "09:00",
        depart: "09:30",
        dwell_minutes: 30,
        lat: 35.67 + index * 0.01,
        lng: 139.7 + index * 0.01,
        photo_count: 1,
      })),
      legs: [],
      total_minutes: 180,
      total_distance_m: 12000,
      spot_count: ids.length,
    },
  };
}

function orderedPoint(id: string, index: number): z.infer<typeof ItinerarySchema>["ordered_points"][number] {
  return {
    id,
    name: `Stop ${String(index + 1)}`,
    bangumi_id: "12345",
    screenshot_url: `https://cdn.test/${id}.jpg`,
    latitude: 35.67 + index * 0.01,
    longitude: 139.7 + index * 0.01,
  };
}

export type { JsonBodyType };
