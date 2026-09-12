/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteCard } from "../../../src/features/chat/components/RouteCard";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { parsedPart, routePartRaw, ujiItinerary, ujiPoints } from "./_route-fixtures";

afterEach(cleanup);
const dict = chatDictFor("ja");
const attach: AttachBasemap = ({ onStatus }) => { onStatus("ready"); return () => undefined; };

function completeRoute() {
  return parsedPart({
    intent: "plan_route", success: true,
    data: {
      itinerary: { ordered_points: ujiPoints(), timed_itinerary: ujiItinerary(), point_count: 3 },
      results: { rows: [{ id: "outside", name: "平等院" }, ...ujiPoints().slice().reverse()] },
    },
  });
}

describe("route card reading order", () => {
  it("places the map before the single itinerary and actions after the stops", () => {
    render(<RouteCard part={completeRoute()} dict={dict} attach={attach} />);
    const map = screen.getByRole("img", { name: dict.route.mapLabel });
    const list = screen.getByRole("list", { name: dict.route.timelineLabel });
    const save = screen.getByRole("button", { name: dict.route.saveCta });
    expect(map.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows each routed stop once and joins its image by id, excluding extra results", () => {
    render(<RouteCard part={completeRoute()} dict={dict} attach={attach} />);
    expect(screen.getAllByText("宇治橋")).toHaveLength(1);
    expect(screen.getAllByText("京阪宇治駅")).toHaveLength(1);
    expect(screen.queryByText("平等院")).toBeNull();
    const first = screen.getByText("宇治橋").closest("li");
    expect(within(first as HTMLElement).getByRole("img").getAttribute("src")).toBe("/scene-a.webp");
    expect(within(first as HTMLElement).getByText("10:00–10:20")).toBeTruthy();
  });

  it("resolves untimed ordered ids against results without inventing times", () => {
    const part = parsedPart({ intent: "plan_route", data: {
      itinerary: { ordered_points: ["b", "a"], point_count: 2 },
      results: { rows: [...ujiPoints(), { id: "outside", name: "平等院" }] },
    } });
    render(<RouteCard part={part} dict={dict} attach={attach} />);
    const stops = document.querySelectorAll(".chat-itinerary__stop");
    expect([...stops].map((stop) => stop.querySelector(".chat-itinerary__name")?.textContent)).toEqual(["京阪宇治駅", "宇治橋"]);
    expect(document.querySelector("time")).toBeNull();
    expect(screen.queryByText("平等院")).toBeNull();
  });

  it("keeps the ordered textual route when no points can be placed on the map", () => {
    const part = parsedPart(routePartRaw([{ id: "a", name: "宇治橋" }, { id: "b", name: "京阪宇治駅" }]));
    render(<RouteCard part={part} dict={dict} attach={attach} />);
    expect(screen.getByRole("list", { name: dict.route.timelineLabel })).toBeTruthy();
    expect(screen.queryByRole("img", { name: dict.route.mapLabel })).toBeNull();
    expect(screen.getByRole("button", { name: dict.route.saveCta })).toBeTruthy();
  });

  it("keeps a streamed point's own photo when its id has not arrived", () => {
    const part = parsedPart(routePartRaw([{ name: "宇治橋", screenshot_url: "/bridge.webp" }]));
    render(<RouteCard part={part} dict={dict} attach={attach} />);
    expect(screen.getByRole("img", { name: "宇治橋" }).getAttribute("src")).toBe("/bridge.webp");
  });
});
