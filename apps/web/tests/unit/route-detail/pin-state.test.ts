import { describe, expect, it } from "vitest";
import type { TimedItinerary, TimedStop } from "@animichi/contract";
import type { RouteDetail } from "../../../src/lib/route-detail/dataState";
import {
  pinBadge,
  pinSizePx,
  routeProgressLabel,
  toRoutePins,
} from "../../../src/lib/route-detail/pinState";

function stop(clusterId: string): TimedStop {
  return {
    cluster_id: clusterId,
    name: clusterId,
    arrive: "09:00",
    depart: "09:30",
    dwell_minutes: 30,
    lat: 34.9,
    lng: 135.8,
    photo_count: 2,
  };
}

function itinerary(ids: readonly string[]): TimedItinerary {
  return { stops: ids.map(stop), legs: [], total_minutes: 60, total_distance_m: 1000 };
}

function makeDetail(overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "r1",
    title: "Loop",
    status: "saved",
    scheduledDate: null,
    itinerary: itinerary(["a", "b", "c"]),
    checkins: [],
    pointCount: 3,
    ...overrides,
  };
}

describe("toRoutePins map-pin language", () => {
  it("marks every pin unvisited when there are no check-ins", () => {
    const pins = toRoutePins(makeDetail());
    expect(pins.map((p) => p.state)).toEqual(["unvisited", "unvisited", "unvisited"]);
  });

  it("lights the first unvisited stop as current once a journey is underway", () => {
    const pins = toRoutePins(makeDetail({ checkins: ["a"] }));
    expect(pins.map((p) => p.state)).toEqual(["visited", "current", "unvisited"]);
  });

  it("marks every pin visited and none current when the route is completed", () => {
    const pins = toRoutePins(makeDetail({ checkins: ["a", "b", "c"] }));
    expect(pins.map((p) => p.state)).toEqual(["visited", "visited", "visited"]);
  });

  it("labels pins by their one-based timetable order", () => {
    const pins = toRoutePins(makeDetail());
    expect(pins.map((p) => p.label)).toEqual(["1", "2", "3"]);
  });

  it("yields no pins when the itinerary is still pending", () => {
    expect(toRoutePins(makeDetail({ itinerary: null }))).toEqual([]);
  });
});

describe("routeProgressLabel gold pill", () => {
  it("renders done over total", () => {
    expect(routeProgressLabel(makeDetail({ checkins: ["a"] }))).toBe("1/3");
  });

  it("stays 0/0 rather than breaking when no itinerary is loaded", () => {
    expect(routeProgressLabel(makeDetail({ itinerary: null }))).toBe("0/0");
  });
});

describe("pin presentation", () => {
  it("overlays ✓ on visited, ★ on current, and nothing on unvisited", () => {
    expect(pinBadge("visited")).toBe("✓");
    expect(pinBadge("current")).toBe("★");
    expect(pinBadge("unvisited")).toBeNull();
  });

  it("swells the current pin to 58px and keeps others at 48px", () => {
    expect(pinSizePx("current")).toBe(58);
    expect(pinSizePx("visited")).toBe(48);
    expect(pinSizePx("unvisited")).toBe(48);
  });
});
