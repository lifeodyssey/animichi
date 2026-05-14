import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultPanelEmptyState } from "../components/layout/ResultPanelEmptyState";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

describe("ResultPanelEmptyState", () => {
  it("renders empty state hint text from dict", () => {
    render(<ResultPanelEmptyState />);
    expect(screen.getByText(defaultDict.grid.empty_hint)).toBeInTheDocument();
  });

  it("renders empty state subtitle from dict", () => {
    render(<ResultPanelEmptyState />);
    expect(screen.getByText(defaultDict.grid.empty_subtitle)).toBeInTheDocument();
  });

  it("renders the search icon SVG", () => {
    const { container } = render(<ResultPanelEmptyState />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders pulsing dot indicators", () => {
    const { container } = render(<ResultPanelEmptyState />);
    // There should be 3 pulsing dots
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(3);
  });
});
