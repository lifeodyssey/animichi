import { describe, expect, it } from "vitest";
import {
  ROUTE_DETAIL_SCHEMA_VERSION,
  completedTotals,
  deriveRouteDataState,
  isRouteEmpty,
  isStopCheckedIn,
  isToday,
} from "../../../src/lib/route-detail/dataState";
import type { RouteDetail } from "../../../src/lib/route-detail/dataState";

const NOW = new Date("2026-07-20T09:00:00");

function makeDetail(overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "r1",
    title: "Suga Shrine loop",
    status: "saved",
    scheduledDate: null,
    itinerary: null,
    checkins: [],
    pointCount: 3,
    ...overrides,
  };
}

describe("isRouteEmpty", () => {
  it("is true only when the route has zero saved points", () => {
    expect(isRouteEmpty(makeDetail({ pointCount: 0 }))).toBe(true);
    expect(isRouteEmpty(makeDetail({ pointCount: 2 }))).toBe(false);
  });
});

describe("deriveRouteDataState priority (completed > today > weekday)", () => {
  it("returns completed when a route is both today and completed", () => {
    const detail = makeDetail({ status: "completed", scheduledDate: "2026-07-20" });
    expect(deriveRouteDataState(detail, NOW)).toBe("completed");
  });

  it("returns today for a route dated for the given day", () => {
    expect(deriveRouteDataState(makeDetail({ scheduledDate: "2026-07-20" }), NOW)).toBe("today");
  });

  it("returns weekday for a saved route dated on another day", () => {
    expect(deriveRouteDataState(makeDetail({ scheduledDate: "2026-07-19" }), NOW)).toBe("weekday");
  });

  it("returns weekday for a route with no scheduled date", () => {
    expect(deriveRouteDataState(makeDetail(), NOW)).toBe("weekday");
  });
});

describe("isToday", () => {
  it("is false when no date is scheduled", () => {
    expect(isToday(makeDetail(), NOW)).toBe(false);
  });

  it("is true only on the matching calendar day", () => {
    expect(isToday(makeDetail({ scheduledDate: "2026-07-20" }), NOW)).toBe(true);
  });
});

describe("isStopCheckedIn preserves historical marks", () => {
  it("is true for a checked-in cluster and false otherwise", () => {
    const detail = makeDetail({ checkins: ["c1", "c3"] });
    expect(isStopCheckedIn(detail, "c1")).toBe(true);
    expect(isStopCheckedIn(detail, "c2")).toBe(false);
  });
});

describe("completedTotals", () => {
  it("counts check-ins against the itinerary stop count", () => {
    const detail = makeDetail({
      checkins: ["c1", "c2"],
      itinerary: {
        stops: [
          { cluster_id: "c1", name: "A", arrive: "09:00", depart: "09:30", dwell_minutes: 30, lat: 0, lng: 0, photo_count: 1 },
          { cluster_id: "c2", name: "B", arrive: "10:00", depart: "10:30", dwell_minutes: 30, lat: 0, lng: 0, photo_count: 1 },
        ],
        legs: [],
        total_minutes: 60,
        total_distance_m: 0,
      },
    });
    expect(completedTotals(detail)).toEqual({ done: 2, total: 2 });
  });

  it("reports zero total when no itinerary is loaded", () => {
    expect(completedTotals(makeDetail())).toEqual({ done: 0, total: 0 });
  });
});

describe("schema version", () => {
  it("exposes the current route-detail schema version", () => {
    expect(ROUTE_DETAIL_SCHEMA_VERSION).toBe(1);
  });
});
