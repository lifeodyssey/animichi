/**
 * SpotGroup — collapsible group of spot cards with header.
 * GroupToggle — episode/area toggle switch.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => ({
    grid: { episode: "EP{ep}" },
    spot_list: {
      empty_title: "No spots found",
      empty_hint: "Try refining your search",
      empty_retry: "Search again",
      empty_refine: "Refine query",
      walking_route: "Walking route",
      ep_badge: "Ep. {ep}",
      photo_missing: "No photo",
    },
  })),
  useLocale: vi.fn(() => "ja"),
}));

import SpotGroup from "@/components/spots/SpotGroup";
import GroupToggle from "@/components/spots/GroupToggle";
import type { PilgrimagePoint } from "@/lib/types";

function makePoint(id: string, name: string, ep: number): PilgrimagePoint {
  return {
    id, name, name_cn: null, episode: ep, time_seconds: null,
    screenshot_url: `https://example.com/${id}.jpg`,
    bangumi_id: "1", latitude: 35, longitude: 135,
  };
}

describe("SpotGroup", () => {
  const points = [
    makePoint("1", "京都コンサートホール", 1),
    makePoint("2", "宇治橋", 2),
  ];

  it("renders group title", () => {
    render(<SpotGroup title="第 1–3 話" count={12} points={points} />);
    expect(screen.getByText("第 1–3 話")).toBeInTheDocument();
  });

  it("renders spot count", () => {
    render(<SpotGroup title="第 1–3 話" count={12} points={points} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("shows cards when expanded", () => {
    render(<SpotGroup title="EP 1" count={2} points={points} defaultOpen />);
    expect(screen.getByText("京都コンサートホール")).toBeInTheDocument();
    expect(screen.getByText("宇治橋")).toBeInTheDocument();
  });

  it("hides cards when collapsed", () => {
    render(<SpotGroup title="EP 1" count={2} points={points} defaultOpen={false} />);
    expect(screen.queryByText("京都コンサートホール")).not.toBeInTheDocument();
  });

  it("toggles on header click", async () => {
    const user = userEvent.setup();
    render(<SpotGroup title="EP 1" count={2} points={points} defaultOpen={false} />);
    expect(screen.queryByText("京都コンサートホール")).not.toBeInTheDocument();
    await user.click(screen.getByText("EP 1"));
    expect(screen.getByText("京都コンサートホール")).toBeInTheDocument();
  });
});

describe("GroupToggle", () => {
  it("renders episode and area options", () => {
    render(<GroupToggle value="episode" onChange={vi.fn()} episodeLabel="Episode" areaLabel="Area" />);
    expect(screen.getByRole("button", { name: /集数|Episode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /エリア|Area/i })).toBeInTheDocument();
  });

  it("calls onChange when toggled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GroupToggle value="episode" onChange={onChange} episodeLabel="Episode" areaLabel="Area" />);
    await user.click(screen.getByRole("button", { name: /エリア|Area/i }));
    expect(onChange).toHaveBeenCalledWith("area");
  });

  it("marks active option", () => {
    render(<GroupToggle value="area" onChange={vi.fn()} episodeLabel="Episode" areaLabel="Area" />);
    const areaBtn = screen.getByRole("button", { name: /エリア|Area/i });
    expect(areaBtn.className).toContain("primary");
  });
});
