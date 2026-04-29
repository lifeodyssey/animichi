/**
 * Filmstrip — horizontal-scrolling scene preview strip.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n-context", () => ({
  useLocale: vi.fn(() => "ja"),
}));

import Filmstrip from "@/components/spots/Filmstrip";
import type { PilgrimagePoint } from "@/lib/types";

function makePoints(n: number): PilgrimagePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-${i}`,
    name: `Spot ${i}`,
    name_cn: null,
    episode: i + 1,
    time_seconds: null,
    screenshot_url: `https://example.com/${i}.jpg`,
    bangumi_id: "1",
    latitude: 35 + i * 0.01,
    longitude: 135 + i * 0.01,
  }));
}

describe("Filmstrip", () => {
  it("renders all spot images", () => {
    render(<Filmstrip points={makePoints(5)} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(5);
  });

  it("renders spot names as overlays", () => {
    render(<Filmstrip points={makePoints(3)} />);
    expect(screen.getByText("Spot 0")).toBeInTheDocument();
    expect(screen.getByText("Spot 2")).toBeInTheDocument();
  });

  it("renders nothing when points empty", () => {
    const { container } = render(<Filmstrip points={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("skips points without screenshot_url", () => {
    const points = makePoints(3);
    points[1].screenshot_url = null;
    render(<Filmstrip points={points} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
