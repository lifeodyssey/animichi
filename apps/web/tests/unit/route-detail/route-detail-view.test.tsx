/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteDetailView } from "../../../src/features/route-detail/components/RouteDetailView";
import type { RouteDetail } from "../../../src/features/route-detail/lib/data-state";

afterEach(cleanup);

const TODAY = new Date("2026-07-20T09:00:00");

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

/** The mode the map is in, read off the toggle's `aria-pressed` (see MapCard). */
function mapExpanded(): string | null {
  return screen.getByRole("button", { name: /地図を/u }).getAttribute("aria-pressed");
}

describe("RouteDetailView data-illuminated states", () => {
  it("shows the gold bar and auto-expands the map in the today state", () => {
    render(<RouteDetailView detail={makeDetail({ scheduledDate: "2026-07-20" })} locale="ja" now={TODAY} />);
    expect(screen.getByRole("link", { name: /巡礼日/ })).toBeTruthy();
    expect(mapExpanded()).toBe("true");
  });

  it("hides the gold bar and keeps the map collapsed in the weekday state", () => {
    render(<RouteDetailView detail={makeDetail({ scheduledDate: "2026-07-19" })} locale="ja" now={TODAY} />);
    expect(screen.queryByRole("link", { name: /巡礼日/ })).toBeNull();
    expect(mapExpanded()).toBe("false");
  });

  it("renders the 完走 badge in the completed state", () => {
    const detail = makeDetail({ status: "completed", pointCount: 2 });
    render(<RouteDetailView detail={detail} locale="ja" now={TODAY} />);
    expect(screen.getByText(/完走/)).toBeTruthy();
  });

  it("renders the empty state when the route has zero points", () => {
    render(<RouteDetailView detail={makeDetail({ pointCount: 0 })} locale="ja" now={TODAY} />);
    expect(screen.getByText("このルートにはまだ地点がありません")).toBeTruthy();
  });

  it("renders the timetable skeleton while the itinerary is still pending", () => {
    render(<RouteDetailView detail={makeDetail()} locale="en" now={TODAY} />);
    expect(screen.getByText("Preparing the schedule")).toBeTruthy();
  });
});
