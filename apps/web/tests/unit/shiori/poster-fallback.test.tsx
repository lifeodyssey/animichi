/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PosterFallback } from "../../../src/features/shiori/layouts/PosterFallback";
import { makeItinerary, makeMeta } from "./_factories";

afterEach(cleanup);

describe("PosterFallback", () => {
  it("renders the completion badge over the route title", () => {
    render(<PosterFallback meta={makeMeta()} itinerary={makeItinerary()} />);

    expect(screen.getByText("2/2")).toBeTruthy();
    expect(screen.getByText("完走")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "飛騨古川 半日ルート" })).toBeTruthy();
  });

  it("marks every visited stop with a completion check", () => {
    render(<PosterFallback meta={makeMeta()} itinerary={makeItinerary()} />);

    const stops = screen.getAllByRole("listitem");
    expect(stops).toHaveLength(2);
    expect(stops[0]?.textContent).toContain("飛騨古川駅");
    expect(stops[0]?.textContent).toContain("✓");
  });

  it("still renders a valid poster when the itinerary has no stops", () => {
    render(<PosterFallback meta={makeMeta()} itinerary={makeItinerary({ stops: [] })} />);

    expect(screen.getByText("0/0")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("heading", { name: "飛騨古川 半日ルート" })).toBeTruthy();
  });
});
