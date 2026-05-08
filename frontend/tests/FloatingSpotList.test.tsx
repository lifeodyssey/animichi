/**
 * FloatingSpotList — overlay spot list for map view.
 *
 * AC coverage:
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
    // POINT_B has name_cn, so it should display the Chinese name
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
    expect(img).toHaveAttribute("src", "https://example.com/img.jpg");
  });

  it("shows placeholder when screenshot_url is null", () => {
    render(<FloatingSpotList {...baseProps} />);
    // POINT_B has null screenshot_url, so it should show index number
    const spotItem = screen.getByTestId("spot-item-pt-002");
    // The placeholder div contains the number "2"
    expect(spotItem.querySelector(".bg-muted")).toBeInTheDocument();
  });
});
