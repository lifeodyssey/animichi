import type { Itinerary, SavedRoute } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import {
  loadRouteDetail,
  projectRouteDetail,
  routeCoordinateOrder,
  selectSavedRoute,
  type RouteDetailReadPort,
} from "../../../src/features/route-detail/load-route-detail";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const route: SavedRoute = {
  id: ROUTE_ID,
  title: "Suga Shrine loop",
  point_ids: ["p1", "p2", "p3"],
  status: "saved",
  saved_at: "2026-07-18T00:00:00.000Z",
  updated_at: "2026-07-18T00:00:00.000Z",
};

const itinerary: Itinerary = {
  ordered_points: [],
  point_count: 3,
  timed_itinerary: {
    stops: [
      { cluster_id: "p1", name: "A", arrive: "09:00", depart: "09:30", dwell_minutes: 30, lat: 1, lng: 1, photo_count: 1 },
      { cluster_id: "p2", name: "B", arrive: "10:00", depart: "10:30", dwell_minutes: 30, lat: 2, lng: 2, photo_count: 1 },
      { cluster_id: "p3", name: "C", arrive: "11:00", depart: "11:30", dwell_minutes: 30, lat: 3, lng: 3, photo_count: 1 },
    ],
    legs: [],
    total_minutes: 180,
    total_distance_m: 9000,
  },
};

function port(overrides: Partial<RouteDetailReadPort> = {}): RouteDetailReadPort {
  return {
    listOwned: () => Promise.resolve({ saved_routes: [route] }),
    planItinerary: () => Promise.resolve(itinerary),
    ...overrides,
  };
}

describe("LoadRouteDetail read journey", () => {
  it("selects the owned route then plans its itinerary in one journey", async () => {
    const planned = await loadRouteDetail(port(), ROUTE_ID);
    expect(planned).toMatchObject({ id: ROUTE_ID, title: "Suga Shrine loop", pointCount: 3 });
    expect(planned.itinerary?.stops.map((stop) => stop.cluster_id)).toEqual(["p1", "p2", "p3"]);
  });

  it("throws a router 404 for an unknown route id", async () => {
    await expect(loadRouteDetail(port(), OTHER_ID)).rejects.toMatchObject({
      name: "Error", message: "unknown route id",
    });
  });

  it("propagates a catalog point-reader failure", async () => {
    await expect(
      loadRouteDetail(port({ planItinerary: () => Promise.reject(new Error("catalog unavailable")) }), ROUTE_ID),
    ).rejects.toThrow("catalog unavailable");
  });
});

describe("selectSavedRoute (route selection)", () => {
  it("returns the owned route matching the id", () => {
    expect(selectSavedRoute([route], ROUTE_ID)).toEqual(route);
  });

  it("throws a router 404 when no owned route matches", () => {
    expect(() => selectSavedRoute([route], OTHER_ID)).toThrow("unknown route id");
  });
});

describe("projectRouteDetail (state projection)", () => {
  it("maps the owned route and planned itinerary to the detail model", () => {
    const detail = projectRouteDetail(route, itinerary);
    expect(detail).toMatchObject({
      id: ROUTE_ID, title: "Suga Shrine loop", status: "saved",
      scheduledDate: null, checkins: [], pointCount: 3,
    });
    expect(detail.itinerary?.stops).toHaveLength(3);
  });

  it("keeps the itinerary in walking order through the projection", () => {
    expect(projectRouteDetail(route, itinerary).itinerary?.stops.map((stop) => stop.cluster_id))
      .toEqual(["p1", "p2", "p3"]);
  });
});

describe("routeCoordinateOrder (coordinate order)", () => {
  it("returns the itinerary stops' coordinates in walking order", () => {
    expect(routeCoordinateOrder(route, itinerary)).toEqual([
      { lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 },
    ]);
  });

  it("returns an empty order for a route with no saved points", () => {
    const empty = { ...route, point_ids: [] };
    expect(routeCoordinateOrder(empty, itinerary)).toEqual([]);
  });
});
