/**
 * SpotCard — pilgrimage spot card with browse and select modes.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => ({ grid: { episode: "EP{ep}" } })),
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
    expect(screen.getByText("EP3")).toBeInTheDocument();
  });

  it("hides episode badge when episode is 0", () => {
    render(<SpotCard point={makePoint({ episode: 0 })} mode="browse" />);
    expect(screen.queryByText("EP0")).not.toBeInTheDocument();
  });

  it("hides episode badge when episode is null", () => {
    render(<SpotCard point={makePoint({ episode: null })} mode="browse" />);
    expect(screen.queryByText(/EP/)).not.toBeInTheDocument();
  });

  it("renders screenshot image with alt text", () => {
    render(<SpotCard point={makePoint()} mode="browse" />);
    const img = screen.getByRole("img", { name: "京都コンサートホール" });
    expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
  });
});

describe("SpotCard — select mode", () => {
  it("renders checkbox", () => {
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
