/**
 * SpotCard — pilgrimage spot card with browse and select modes.
 *
 * AC coverage (C2):
 * - Boundary: 60-char name truncates with ellipsis (no wrap-induced layout break) -> unit
 * - Boundary: thumbnails use loading="lazy" -> unit
 * - Error: broken thumbnail URL shows fallback, card height stays stable -> unit
 * - i18n: card meta ("walking route" etc.) localized -> unit
 * - Happy: spot renders in select mode -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockDict = {
  spot_list: {
    empty_title: "No spots found",
    empty_hint: "Try refining your search",
    empty_retry: "Search again",
    empty_refine: "Refine query",
    walking_route: "Walking route",
    ep_badge: "Ep. {ep}",
    photo_missing: "No photo",
  },
  grid: { episode: "EP{ep}" },
};

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => mockDict),
  useLocale: vi.fn(() => "ja"),
}));

import SpotCard from "@/components/spots/SpotCard";
import type { PilgrimagePoint } from "@/lib/types";

function makePoint(overrides: Partial<PilgrimagePoint> = {}): PilgrimagePoint {
  return {
    id: "test-1",
    name: "京都コンサートホール",
    name_cn: "京都音乐厅",
    episode: 1,
    time_seconds: null,
    screenshot_url: "https://example.com/photo.jpg",
    bangumi_id: "283643",
    latitude: 35.05,
    longitude: 135.77,
    ...overrides,
  };
}

describe("SpotCard — browse mode", () => {
  it("renders spot name", () => {
    render(<SpotCard point={makePoint()} mode="browse" />);
    expect(screen.getByText("京都コンサートホール")).toBeInTheDocument();
  });

  it("renders episode badge for valid episodes", () => {
    render(<SpotCard point={makePoint({ episode: 3 })} mode="browse" />);
    expect(screen.getByText("Ep. 3")).toBeInTheDocument();
  });

  it("hides episode badge when episode is 0", () => {
    render(<SpotCard point={makePoint({ episode: 0 })} mode="browse" />);
    expect(screen.queryByText(/Ep\. 0/)).not.toBeInTheDocument();
  });

  it("hides episode badge when episode is null", () => {
    render(<SpotCard point={makePoint({ episode: null })} mode="browse" />);
    expect(screen.queryByText(/Ep\./)).not.toBeInTheDocument();
  });

  it("renders screenshot image with alt text", () => {
    render(<SpotCard point={makePoint()} mode="browse" />);
    const img = screen.getByRole("img", { name: "京都コンサートホール" });
    expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
  });

  it("[C2 Boundary] thumbnail uses loading=lazy", () => {
    render(<SpotCard point={makePoint()} mode="browse" />);
    const img = screen.getByRole("img", { name: "京都コンサートホール" });
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("[C2 Boundary] 60-char name renders in truncate container without wrapping", () => {
    const longName = "あ".repeat(60);
    render(<SpotCard point={makePoint({ name: longName })} mode="browse" />);
    const nameEl = screen.getByText(longName);
    expect(nameEl).toHaveClass("truncate");
  });

  it("[C2 Error] broken image URL shows photo_missing fallback", () => {
    render(<SpotCard point={makePoint()} mode="browse" />);
    const img = screen.getByRole("img", { name: "京都コンサートホール" });
    fireEvent.error(img);
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("[C2 Error] null screenshot_url shows photo_missing fallback", () => {
    render(<SpotCard point={makePoint({ screenshot_url: null })} mode="browse" />);
    expect(screen.getByText("No photo")).toBeInTheDocument();
  });

  it("[C2 i18n] ep_badge uses localized template", () => {
    render(<SpotCard point={makePoint({ episode: 7 })} mode="browse" />);
    expect(screen.getByText("Ep. 7")).toBeInTheDocument();
  });

  it("[C2 i18n] photo_missing uses localized string", () => {
    render(<SpotCard point={makePoint({ screenshot_url: null })} mode="browse" />);
    expect(screen.getByText("No photo")).toBeInTheDocument();
  });
});

describe("SpotCard — select mode", () => {
  it("renders as a button", () => {
    render(
      <SpotCard point={makePoint()} mode="select" selected={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls onToggle with point id when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <SpotCard point={makePoint()} mode="select" selected={false} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("test-1");
  });

  it("shows selected state visually", () => {
    render(
      <SpotCard point={makePoint()} mode="select" selected={true} onToggle={vi.fn()} />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
