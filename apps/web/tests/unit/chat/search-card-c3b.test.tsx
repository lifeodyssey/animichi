/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { toSearchSpots } from "../../../src/lib/chat/spotClusters";
import type { SpotRowLike } from "../../../src/lib/chat/spotClusters";

afterEach(cleanup);

const dict = chatDictFor("ja");
const attachReady: AttachBasemap = ({ onStatus }) => {
  onStatus("ready");
  return () => undefined;
};

function row(id: string, lat: number, lng: number, city: string): SpotRowLike {
  return { id, name: id, lat, lng, city, screenshot_url: "/s.webp" };
}

const TWO_CLUSTERS: readonly SpotRowLike[] = [
  row("u1", 34.89, 135.8, "宇治市"),
  row("u2", 34.9, 135.81, "宇治市"),
  row("u3", 34.91, 135.8, "宇治市"),
  row("t1", 35.69, 139.7, "新宿区"),
  row("t2", 35.7, 139.71, "新宿区"),
];

function renderMulti() {
  return render(<SearchResult spots={toSearchSpots(TWO_CLUSTERS)} dict={dict} attach={attachReady} />);
}

function bubbleWidth(name: string): number {
  const bubble = screen.getByRole("button", { name: new RegExp(name) });
  return Number.parseFloat(bubble.style.width);
}

describe("C3b bubble overview (AC: bubbles only, area ∝ count, badge)", () => {
  it("renders one bubble per cluster and never an individual pin", () => {
    renderMulti();
    expect(document.querySelectorAll(".chat-map-bubble")).toHaveLength(2);
    expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("labels each bubble with its place name and localized count badge", () => {
    renderMulti();
    expect(screen.getByText("宇治市")).toBeTruthy();
    expect(screen.getByText("新宿区")).toBeTruthy();
    expect(screen.getByText("3件")).toBeTruthy();
    expect(screen.getByText("2件")).toBeTruthy();
  });

  it("scales bubble size with spot count (area ∝ count)", () => {
    renderMulti();
    expect(bubbleWidth("宇治市")).toBeGreaterThan(bubbleWidth("新宿区"));
  });

  it("drills into the C3a single-cluster view when a bubble is selected", () => {
    renderMulti();
    fireEvent.click(screen.getByRole("button", { name: /宇治市/ }));
    expect(document.querySelectorAll(".chat-map-bubble")).toHaveLength(0);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(3);
  });
});

/** Issue #437 item 2: the drill used to be a dead end with no route back. */
describe("C3b drill-down back affordance (issue #437)", () => {
  const back = (): HTMLElement => screen.getByRole("button", { name: dict.search.backToOverview });

  it("offers no back affordance while the overview itself is showing", () => {
    renderMulti();
    expect(screen.queryByRole("button", { name: dict.search.backToOverview })).toBeNull();
  });

  it("shows the back chip once a cluster is drilled into", () => {
    renderMulti();
    fireEvent.click(screen.getByRole("button", { name: /宇治市/ }));
    expect(back().className).toContain("chat-drill__back");
  });

  it("returns to the bubble overview when the back chip is pressed", () => {
    renderMulti();
    fireEvent.click(screen.getByRole("button", { name: /宇治市/ }));
    fireEvent.click(back());
    expect(document.querySelectorAll(".chat-map-bubble")).toHaveLength(2);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("lets a second cluster be drilled into after coming back", () => {
    renderMulti();
    fireEvent.click(screen.getByRole("button", { name: /宇治市/ }));
    fireEvent.click(back());
    fireEvent.click(screen.getByRole("button", { name: /新宿区/ }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});
