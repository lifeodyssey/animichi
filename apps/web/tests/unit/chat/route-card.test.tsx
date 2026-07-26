/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { RouteCard } from "../../../src/features/chat/components/RouteCard";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { parsedPart, routePartRaw, routePoint, ujiItinerary, ujiPoints } from "./_route-fixtures";

afterEach(cleanup);

const dict = chatDictFor("ja");
const attachReady: AttachBasemap = ({ onStatus }) => {
  onStatus("ready");
  return () => undefined;
};

function fullRouteRaw() {
  const offRoute = { id: "x", name: "平等院", latitude: 34.889, longitude: 135.808, screenshot_url: "", episode: -1 };
  return {
    ...routePartRaw(ujiPoints().slice(), { timed_itinerary: ujiItinerary() }),
    data: {
      results: { rows: [...ujiPoints(), offRoute] },
      route: { ordered_points: ujiPoints().slice(), point_count: 3, timed_itinerary: ujiItinerary() },
    },
  };
}

function renderRouteCard(raw: unknown = fullRouteRaw()) {
  return render(<RouteCard part={parsedPart(raw)} dict={dict} attach={attachReady} />);
}

describe("route card composition (S1.5 replaces the stats-only card)", () => {
  it("renders the timeline, the promoted map, and the spot strip together", () => {
    renderRouteCard();
    expect(screen.getByRole("list", { name: dict.route.timelineLabel })).toBeTruthy();
    expect(screen.getByRole("img", { name: dict.route.mapLabel })).toBeTruthy();
    expect(document.querySelector(".chat-card__spots")).toBeTruthy();
  });

  it("dims exactly the located result spots the planner left off the route", () => {
    renderRouteCard();
    expect(document.querySelectorAll(".chat-route-pin")).toHaveLength(3);
    expect(document.querySelectorAll(".chat-map-pin--dimmed")).toHaveLength(1);
  });

  it("renders no timeline and no map when the route carries neither", () => {
    renderRouteCard(routePartRaw([{ id: "a", name: "宇治橋" }]));
    expect(screen.queryByRole("list", { name: dict.route.timelineLabel })).toBeNull();
    expect(document.querySelector(".chat-search-map")).toBeNull();
    expect(screen.getByText("宇治橋")).toBeTruthy();
  });
});

describe("AC5: a 404'd scene still degrades to the D9 placeholder", () => {
  it("swaps the broken img for the gradient placeholder with episode text", () => {
    renderRouteCard();
    const img = document.querySelector("img.chat-scene-thumb");
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);
    expect(document.querySelector("img.chat-scene-thumb")).toBeNull();
    expect(screen.getByText("第8話").className).toContain("chat-scene-thumb--fallback");
  });

  it("never renders a thumb or a leaked -1 episode for sentinel rows", () => {
    renderRouteCard();
    expect(document.querySelectorAll("img.chat-scene-thumb")).toHaveLength(1);
    expect(screen.queryByText(/第-1話/)).toBeNull();
  });

  it("keeps the -1 episode sentinel out of the D9 placeholder label", () => {
    renderRouteCard(routePartRaw([routePoint({ id: "a", name: "宇治橋", screenshot: "/broken.webp" })]));
    fireEvent.error(screen.getByRole("img"));
    const placeholder = document.querySelector(".chat-scene-thumb--fallback");
    expect(placeholder?.textContent).toBe("");
  });
});

describe("AC4: a short route still renders the card plus the D3 note", () => {
  it("keeps the timeline and appends the explanatory notice for <3 spots", () => {
    const short = {
      ...routePartRaw(ujiPoints().slice(0, 2)),
      data: { route: { ordered_points: ujiPoints().slice(0, 2), point_count: 2, timed_itinerary: { ...ujiItinerary(), stops: ujiItinerary().stops.slice(0, 2), legs: ujiItinerary().legs.slice(0, 1) } } },
    };
    render(
      <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
        <DataPartCard data={short} dict={dict} />
      </ChatActionsProvider>,
    );
    expect(screen.getByText(dict.errorStates.d3Notice)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.errorStates.d3Chip })).toBeTruthy();
    expect(screen.getByText("10:00–10:20")).toBeTruthy();
  });
});
