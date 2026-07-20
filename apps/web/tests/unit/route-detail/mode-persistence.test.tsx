/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteDetailView } from "../../../src/components/route-detail/RouteDetailView";
import type { RouteDetail } from "../../../src/lib/route-detail/dataState";

afterEach(cleanup);

const NOW = new Date("2026-07-20T09:00:00");

function makeDetail(overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "r1",
    title: "Loop",
    status: "saved",
    scheduledDate: "2026-07-19",
    itinerary: {
      stops: [
        { cluster_id: "a", name: "A", arrive: "09:00", depart: "09:30", dwell_minutes: 30, lat: 34.9, lng: 135.8, photo_count: 1 },
        { cluster_id: "b", name: "B", arrive: "10:00", depart: "10:30", dwell_minutes: 30, lat: 34.9, lng: 135.8, photo_count: 1 },
      ],
      legs: [],
      total_minutes: 60,
      total_distance_m: 500,
    },
    checkins: [],
    pointCount: 2,
    ...overrides,
  };
}

function mapRegion(): HTMLElement {
  return screen.getByRole("region", { name: "地図" });
}

describe("MODE persistence across a check-in re-render (AC5)", () => {
  it("keeps the expanded mode after a check-in event updates the route", () => {
    const { rerender } = render(<RouteDetailView detail={makeDetail()} locale="ja" now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "地図を広げる" }));
    expect(mapRegion().getAttribute("aria-expanded")).toBe("true");

    rerender(<RouteDetailView detail={makeDetail({ checkins: ["a"] })} locale="ja" now={NOW} />);
    expect(mapRegion().getAttribute("aria-expanded")).toBe("true");
  });
});
