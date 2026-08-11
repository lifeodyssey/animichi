import type { Itinerary, Point, SearchResult } from "@animichi/contract";

/** Base origin the unit MSW swimlane serves; matches the jsdom `location.origin`. */
export const TEST_ORIGIN = "http://localhost:3000";

export const CATALOG_SEARCH_URL = `${TEST_ORIGIN}/catalog/search`;

const hakoneStation = {
  id: "point-1",
  name: "Hakone-Yumoto Station",
  bangumi_id: "12345",
  screenshot_url: "https://cdn.test/point-1.jpg",
  latitude: 35.2323,
  longitude: 139.1069,
} satisfies Point;

/** A valid, contract-shaped catalog search payload. */
export const searchSuccessFixture = {
  rows: [hakoneStation],
  synced_at: "2026-07-18T00:00:00.000Z",
} satisfies SearchResult;

/** One timed stop in the planned itinerary, in walking order. */
const timedStop = (clusterId: string, name: string, lat: number, lng: number) => ({
  cluster_id: clusterId,
  name,
  arrive: "09:00",
  depart: "09:30",
  dwell_minutes: 30,
  lat,
  lng,
  photo_count: 1,
});

/** A valid, contract-shaped planned itinerary for a three-point route. */
export const plannedItineraryFixture = {
  ordered_points: [
    { id: "p1", name: "Suga Shrine", bangumi_id: "12345", screenshot_url: "https://cdn.test/p1.jpg", latitude: 35.6762, longitude: 139.7068 },
    { id: "p2", name: "Kanda Shrine", bangumi_id: "12345", screenshot_url: "https://cdn.test/p2.jpg", latitude: 35.6929, longitude: 139.7708 },
    { id: "p3", name: "Hie Shrine", bangumi_id: "12345", screenshot_url: "https://cdn.test/p3.jpg", latitude: 35.6778, longitude: 139.7394 },
  ],
  point_count: 3,
  timed_itinerary: {
    stops: [
      timedStop("p1", "Suga Shrine", 35.6762, 139.7068),
      timedStop("p2", "Kanda Shrine", 35.6929, 139.7708),
      timedStop("p3", "Hie Shrine", 35.6778, 139.7394),
    ],
    legs: [],
    total_minutes: 180,
    total_distance_m: 12000,
    spot_count: 3,
  },
} satisfies Itinerary;

/** The planItinerary endpoint a route-detail read journey calls. */
export const CATALOG_ITINERARY_URL = `${TEST_ORIGIN}/catalog/itinerary`;

