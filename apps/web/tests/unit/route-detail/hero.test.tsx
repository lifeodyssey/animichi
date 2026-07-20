/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Hero } from "../../../src/components/route-detail/Hero";
import { routeDetailCopyFor } from "../../../src/lib/route-detail/copy";
import type { RouteDetail } from "../../../src/lib/route-detail/dataState";

afterEach(cleanup);

const stop = { arrive: "09:00", depart: "09:30", dwell_minutes: 30, lat: 0, lng: 0, photo_count: 1 };

function completedDetail(): RouteDetail {
  return {
    id: "r1",
    title: "Suga Shrine loop",
    status: "completed",
    scheduledDate: "2026-07-20",
    itinerary: {
      stops: [
        { cluster_id: "c1", name: "A", ...stop },
        { cluster_id: "c2", name: "B", ...stop },
      ],
      legs: [],
      total_minutes: 60,
      total_distance_m: 0,
    },
    checkins: ["c1", "c2"],
    pointCount: 2,
  };
}

describe("Hero", () => {
  it("always renders the route title as the page heading", () => {
    render(<Hero detail={completedDetail()} state="weekday" copy={routeDetailCopyFor("ja")} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Suga Shrine loop");
  });

  it("renders the 完走 badge with N/total in the completed state", () => {
    render(<Hero detail={completedDetail()} state="completed" copy={routeDetailCopyFor("ja")} />);
    expect(screen.getByText("完走 2/2 ✓")).toBeTruthy();
  });

  it("localizes the completed badge for en", () => {
    render(<Hero detail={completedDetail()} state="completed" copy={routeDetailCopyFor("en")} />);
    expect(screen.getByText("Complete 2/2 ✓")).toBeTruthy();
  });

  it("omits the 完走 badge outside the completed state", () => {
    render(<Hero detail={completedDetail()} state="today" copy={routeDetailCopyFor("ja")} />);
    expect(screen.queryByText(/完走/)).toBeNull();
  });
});
