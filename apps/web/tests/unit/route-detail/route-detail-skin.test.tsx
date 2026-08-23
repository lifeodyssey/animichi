/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteDetailPendingState } from "../../../src/features/route-detail/components/RouteDetailStates";
import { RouteDetailView } from "../../../src/features/route-detail/components/RouteDetailView";
import { routeDetailCopyFor } from "../../../src/features/route-detail/lib/copy";
import type { RouteDetail } from "../../../src/features/route-detail/lib/data-state";

afterEach(cleanup);

const NOW = new Date("2026-07-20T09:00:00");
const copy = routeDetailCopyFor("ja");
const stop = { arrive: "09:00", depart: "09:30", dwell_minutes: 30, lat: 34.9, lng: 135.8, photo_count: 1 };

function makeDetail(overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "r1", title: "Loop", status: "saved", scheduledDate: null, pointCount: 2,
    itinerary: { stops: [{ cluster_id: "a", name: "A", ...stop }], legs: [], total_minutes: 30, total_distance_m: 0 },
    checkins: [], ...overrides,
  };
}

/** The rendered skin: every restored element must actually wear its class. */
describe("route-detail skin bindings", () => {
  it("dresses the page shell and the hero as a canvas card", () => {
    render(<RouteDetailView detail={makeDetail()} locale="ja" now={NOW} />);
    expect(screen.getByRole("main").className).toBe("route-detail");
    expect(screen.getByRole("banner").className).toBe("route-card route-hero");
    expect(screen.getByRole("heading", { level: 1 }).className).toBe("route-hero__title");
  });

  it("dresses the 完走 badge and the map progress as gold pills", () => {
    render(<RouteDetailView detail={makeDetail({ status: "completed" })} locale="ja" now={NOW} />);
    expect(screen.getByText(/完走/).className).toBe("route-pill route-pill--gold route-hero__badge");
    expect(screen.getByLabelText(copy.progressAria).className).toBe("route-pill route-pill--gold route-map__pill");
  });

  it("dresses the today gold bar", () => {
    render(<RouteDetailView detail={makeDetail({ scheduledDate: "2026-07-20" })} locale="ja" now={NOW} />);
    expect(screen.getByRole("link", { name: /巡礼日/ }).className).toBe("route-goldbar");
  });

  it("dresses the map card, its foot and the mode control", () => {
    render(<RouteDetailView detail={makeDetail()} locale="ja" now={NOW} />);
    expect(screen.getByRole("region", { name: "地図" }).className).toBe("route-card");
    expect(screen.getByText(copy.mapHint).className).toBe("route-map__hint");
    expect(screen.getByRole("button", { name: copy.mapExpand }).className).toBe("route-press");
  });

  it("dresses the pins as framed markers", () => {
    render(<RouteDetailView detail={makeDetail()} locale="ja" now={NOW} />);
    expect(screen.getByRole("list", { name: "ピン" }).className).toBe("route-pin-layer");
    expect(screen.getByRole("listitem", { name: `${copy.pinUnvisited} 1` }).className).toBe("route-pin");
  });

  it("marks the timetable wrapper as the sheet and the empty slot as a card", () => {
    render(<RouteDetailView detail={makeDetail({ scheduledDate: "2026-07-20" })} locale="ja" now={NOW} />);
    const sheet = screen.getByRole("status", { name: "timetable" }).parentElement;
    expect(sheet?.className).toBe("route-sheet");
    expect(sheet?.getAttribute("data-mode")).toBe("expanded");
  });

  it("dresses the pending route as breathing card silhouettes", () => {
    render(<RouteDetailPendingState />);
    const main = screen.getByRole("status", { name: "Loading" });
    expect(main.className).toBe("route-detail");
    expect([...main.children].map((child) => child.className))
      .toEqual(["route-skeleton route-skeleton--hero", "route-skeleton route-skeleton--map", "route-skeleton route-skeleton--panel"]);
  });
});
