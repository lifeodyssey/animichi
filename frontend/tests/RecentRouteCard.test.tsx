/**
 * RecentRouteCard unit tests — Task C4
 *
 * AC coverage:
 * - Happy: renders cover + title + locations + spots count -> unit
 * - Null/empty: missing thumbnail / 0 spots renders safe placeholder -> unit
 * - i18n: all copy localized -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentRouteCard } from "@/components/generative/RecentRouteCard";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const baseProps = {
  title: "響け！ユーフォニアム",
  locations: ["宇治市", "京都市"],
  spotCount: 8,
  updatedWhen: "昨日",
};

describe("RecentRouteCard — happy path", () => {
  it("renders the anime title", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(screen.getByText(baseProps.title)).toBeInTheDocument();
  });

  it("renders the location labels", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(screen.getByText(/宇治市/)).toBeInTheDocument();
  });

  it("renders spots count", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(
      screen.getByText(
        defaultDict.recent_route_card.spots_count.replace(
          "{count}",
          String(baseProps.spotCount),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("renders the resume vertical label", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(
      screen.getByText(defaultDict.recent_route_card.resume_label),
    ).toBeInTheDocument();
  });

  it("renders thumbnail when provided", () => {
    const { container } = render(
      <RecentRouteCard {...baseProps} thumbnailSrc="/img/test.jpg" />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toContain("test.jpg");
  });
});

describe("RecentRouteCard — null/empty", () => {
  it("renders placeholder when no thumbnailSrc", () => {
    const { container } = render(<RecentRouteCard {...baseProps} />);
    expect(
      container.querySelector("[data-testid='thumbnail-placeholder']"),
    ).toBeInTheDocument();
  });

  it("renders no-spots text when spotCount is 0", () => {
    render(<RecentRouteCard {...baseProps} spotCount={0} />);
    expect(
      screen.getByText(defaultDict.recent_route_card.no_spots),
    ).toBeInTheDocument();
  });

  it("does not crash when locations array is empty", () => {
    expect(() =>
      render(<RecentRouteCard {...baseProps} locations={[]} />),
    ).not.toThrow();
  });
});

describe("RecentRouteCard — i18n", () => {
  it("renders resume label from dictionary", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(
      screen.getByText(defaultDict.recent_route_card.resume_label),
    ).toBeInTheDocument();
  });

  it("renders updated-when label from dictionary", () => {
    render(<RecentRouteCard {...baseProps} />);
    expect(
      screen.getByText(
        defaultDict.recent_route_card.updated.replace(
          "{when}",
          baseProps.updatedWhen,
        ),
      ),
    ).toBeInTheDocument();
  });
});
