/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Ticket } from "../../../src/features/shiori/layouts/Ticket";
import { makeItinerary, makeMeta, makeStop } from "./_factories";

afterEach(cleanup);

describe("Ticket", () => {
  it("renders the route title and anime attribution", () => {
    render(<Ticket meta={makeMeta()} itinerary={makeItinerary()} />);

    expect(screen.getByRole("heading", { name: "飛騨古川 半日ルート" })).toBeTruthy();
    expect(screen.getByText("君の名は。 · 2026.7.3")).toBeTruthy();
  });

  it("lists every stop with its arrival time", () => {
    render(<Ticket meta={makeMeta()} itinerary={makeItinerary()} />);

    const stops = screen.getAllByRole("listitem");
    expect(stops).toHaveLength(2);
    expect(stops[0]?.textContent).toContain("09:31");
    expect(stops[0]?.textContent).toContain("飛騨古川駅");
    expect(stops[1]?.textContent).toContain("気多若宮神社");
  });

  it("shows the route time window from first arrival to last departure", () => {
    render(<Ticket meta={makeMeta()} itinerary={makeItinerary()} />);

    expect(screen.getByText("09:31→12:58")).toBeTruthy();
  });

  it("renders a friendly placeholder instead of a broken ticket when there are no stops", () => {
    render(<Ticket meta={makeMeta()} itinerary={makeItinerary({ stops: [] })} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("スポットを選ぶと、ここに行程が出るよ")).toBeTruthy();
  });

  it("renders a single-stop window without crashing", () => {
    render(<Ticket meta={makeMeta()} itinerary={makeItinerary({ stops: [makeStop()] })} />);

    expect(screen.getByText("09:31→09:50")).toBeTruthy();
  });
});
