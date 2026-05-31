/**
 * FloatingSpotList — overlay spot list for map view.
 *
 * AC coverage (C2):
 * - Happy: 30 spots render in scroll container with selectable cards -> unit
 * - Null/empty: 0 results shows empty state with retry/refine affordance -> unit
 * - Boundary: thumbnails below fold use loading="lazy" -> unit
 * - Error: broken thumbnail shows fallback, container height stays stable -> unit
 * - i18n: empty state localized -> unit
 * - FloatingSpotList renders spot items -> unit
 * - Checkbox toggles selection -> unit
 * - Filter tabs switch between episode and area -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingSpotList } from "@/components/layout/FloatingSpotList";
import type { PilgrimagePoint } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({ useDict: () => defaultDict }));

const POINT_A: PilgrimagePoint = {
  id: "pt-001",
  name: "宇治駅",
  name_cn: null,
  episode: 1,
  time_seconds: null,
  screenshot_url: "https://example.com/img.jpg",
  bangumi_id: "bg-001",
  latitude: 34.88,
  longitude: 135.8,
};

const POINT_B: PilgrimagePoint = {
  id: "pt-002",
  name: "京アニスタジオ",
  name_cn: "京阿尼工作室",
  episode: 4,
  time_seconds: null,
  screenshot_url: null,
  bangumi_id: "bg-001",
  latitude: 34.89,
  longitude: 135.81,
};

function makePoint(i: number): PilgrimagePoint {
  return {
    id: `pt-${i.toString().padStart(3, "0")}`,
    name: `スポット ${i}`,
    name_cn: null,
    episode: i,
    time_seconds: null,
    screenshot_url: `https://example.com/img${i}.jpg`,
    bangumi_id: "bg-001",
    latitude: 34.88 + i * 0.001,
    longitude: 135.8 + i * 0.001,
  };
}

const baseProps = {
  points: [POINT_A, POINT_B],
  visiblePoints: [POINT_A, POINT_B],
  selectedIds: new Set<string>(),
  onToggle: vi.fn(),
  onPointClick: vi.fn(),
  filterMode: "episode" as const,
  onFilterModeChange: vi.fn(),
  epRanges: ["EP 1-4"],
  areas: ["宇治"],
  activeEpRange: null,
  activeArea: null,
  onEpRangeChange: vi.fn(),
  onAreaChange: vi.fn(),
  totalCount: 2,
};

describe("FloatingSpotList", () => {
  it("renders spot items for each visible point", () => {
    render(<FloatingSpotList {...baseProps} />);
    expect(screen.getByTestId("spot-item-pt-001")).toBeInTheDocument();
    expect(screen.getByTestId("spot-item-pt-002")).toBeInTheDocument();
  });

  it("displays spot names with numbering", () => {
    render(<FloatingSpotList {...baseProps} />);
    expect(screen.getByText(/1\. 宇治駅/)).toBeInTheDocument();
    expect(screen.getByText(/2\. 京阿尼工作室/)).toBeInTheDocument();
  });

  it("renders header with spots count", () => {
    render(<FloatingSpotList {...baseProps} />);
    expect(screen.getByText(defaultDict.result_panel.spots_header)).toBeInTheDocument();
    expect(screen.getByText("2件")).toBeInTheDocument();
  });

  it("calls onToggle when checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(<FloatingSpotList {...baseProps} onToggle={onToggle} />);
    const checkbox = screen.getByLabelText("Select 宇治駅");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("pt-001");
  });

  it("calls onPointClick when spot item is clicked", () => {
    const onPointClick = vi.fn();
    render(<FloatingSpotList {...baseProps} onPointClick={onPointClick} />);
    fireEvent.click(screen.getByTestId("spot-item-pt-001"));
    expect(onPointClick).toHaveBeenCalledWith(POINT_A);
  });

  it("renders filter tabs for episode and area", () => {
    render(<FloatingSpotList {...baseProps} />);
    expect(screen.getByText(defaultDict.toolbar.tab_episode)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.toolbar.tab_area)).toBeInTheDocument();
  });

  it("calls onFilterModeChange when area tab is clicked", () => {
    const onFilterModeChange = vi.fn();
    render(<FloatingSpotList {...baseProps} onFilterModeChange={onFilterModeChange} />);
    fireEvent.click(screen.getByText(defaultDict.toolbar.tab_area));
    expect(onFilterModeChange).toHaveBeenCalledWith("area");
  });

  it("renders filter chips", () => {
    render(<FloatingSpotList {...baseProps} />);
    expect(screen.getByText(defaultDict.toolbar.all)).toBeInTheDocument();
    expect(screen.getByText("EP 1-4")).toBeInTheDocument();
  });

  it("shows thumbnail when screenshot_url is present", () => {
    render(<FloatingSpotList {...baseProps} />);
    const img = screen.getByAltText("宇治駅");
    expect(img).toBeInTheDocument();
  });

  it("shows placeholder index when screenshot_url is null", () => {
    render(<FloatingSpotList {...baseProps} />);
    const spotItem = screen.getByTestId("spot-item-pt-002");
    expect(spotItem.querySelector(".bg-muted")).toBeInTheDocument();
  });

  // C2 AC: Happy path — 30+ spots in scroll container
  it("[C2 Happy] renders 30 spots in a scroll container", () => {
    const thirtyPoints = Array.from({ length: 30 }, (_, i) => makePoint(i + 1));
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={thirtyPoints}
        points={thirtyPoints}
        totalCount={30}
      />,
    );
    const list = screen.getByTestId("floating-spot-list");
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(30);
  });

  it("[C2 Happy] 30-spot scroll container has overflow-y-auto", () => {
    const thirtyPoints = Array.from({ length: 30 }, (_, i) => makePoint(i + 1));
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={thirtyPoints}
        points={thirtyPoints}
        totalCount={30}
      />,
    );
    const scrollable = screen
      .getByTestId("floating-spot-list")
      .querySelector(".overflow-y-auto");
    expect(scrollable).toBeInTheDocument();
  });

  // C2 AC: Null/empty — 0 results shows empty state
  it("[C2 Null] 0 results shows empty state", () => {
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={[]}
        totalCount={0}
      />,
    );
    expect(screen.getByTestId("spot-list-empty")).toBeInTheDocument();
  });

  it("[C2 Null] empty state shows retry and refine affordances", () => {
    const onRetry = vi.fn();
    const onRefine = vi.fn();
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={[]}
        totalCount={0}
        onRetry={onRetry}
        onRefine={onRefine}
      />,
    );
    expect(screen.getByText(defaultDict.spot_list.empty_retry)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.spot_list.empty_refine)).toBeInTheDocument();
  });

  it("[C2 Null] retry button calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={[]}
        totalCount={0}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByText(defaultDict.spot_list.empty_retry));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // C2 AC: Boundary — thumbnails use loading="lazy"
  it("[C2 Boundary] thumbnails use loading=lazy", () => {
    render(<FloatingSpotList {...baseProps} />);
    const img = screen.getByAltText("宇治駅");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  // C2 AC: Error — broken thumbnail shows fallback, height stable
  it("[C2 Error] broken thumbnail shows fallback with stable 36x36 container", () => {
    render(<FloatingSpotList {...baseProps} />);
    const img = screen.getByAltText("宇治駅");
    fireEvent.error(img);
    // img is gone, placeholder with index is shown
    expect(screen.queryByAltText("宇治駅")).not.toBeInTheDocument();
    const spot = screen.getByTestId("spot-item-pt-001");
    // Fallback div keeps 36x36 (h-9 w-9) via bg-muted class
    const fallback = spot.querySelector(".h-9.w-9.bg-muted");
    expect(fallback).toBeInTheDocument();
  });

  // C2 AC: i18n — empty state localized
  it("[C2 i18n] empty state title is localized", () => {
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={[]}
        totalCount={0}
      />,
    );
    expect(
      screen.getByText(defaultDict.spot_list.empty_title),
    ).toBeInTheDocument();
  });

  it("[C2 i18n] empty state hint is localized", () => {
    render(
      <FloatingSpotList
        {...baseProps}
        visiblePoints={[]}
        totalCount={0}
      />,
    );
    expect(
      screen.getByText(defaultDict.spot_list.empty_hint),
    ).toBeInTheDocument();
  });
});
