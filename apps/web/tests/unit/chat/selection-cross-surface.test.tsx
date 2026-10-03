/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectableSpotMap } from "../../../src/features/chat/components/SelectableSpotMap";
import { SpotCardGrid } from "../../../src/features/chat/components/SearchSpotCard";
import { SpotSelectionProvider, useSpotSelectionState } from "../../../src/features/chat/selection/use-spot-selection";
import { attachFailing, attachReady } from "./basemap-fixture";
import { chatDictFor } from "../../../src/features/chat/i18n";
import type { LocatedSpot } from "../../../src/features/chat/lib/spot-clusters";

afterEach(cleanup);
const dict = chatDictFor("zh");

/** Photo order (topSpots lifts the image first) differs from map order: an
 * index-keyed selection cannot tell the two surfaces apart, so this set is the
 * mutation check. */
const spots: readonly LocatedSpot[] = [
  { id: "keihan", name: "京阪宇治駅", city: "宇治市", coord: { lat: 34.8945, lng: 135.8079 } },
  { id: "bridge", name: "宇治橋", screenshotUrl: "/bridge.webp", city: "宇治市", coord: { lat: 34.893, lng: 135.8077 } },
  { id: "shrine", name: "宇治神社", city: "宇治市", coord: { lat: 34.8918, lng: 135.8118 } },
];

const markerLayer = () => {
  const overlay = document.querySelector(".chat-search-map__overlay");
  if (!(overlay instanceof HTMLElement)) throw new Error("map markers missing");
  return overlay;
};

const cardOf = (name: string) => {
  const card = [...document.querySelectorAll("li.chat-spot-card")].find((item) => item.textContent.includes(name));
  if (!(card instanceof HTMLElement)) throw new Error("photo card missing");
  return card;
};

const cardSelected = (name: string) => cardOf(name).getAttribute("data-selected");
const cardPick = (name: string) => within(cardOf(name)).getByRole("checkbox");
const openPin = (name: string) => fireEvent.click(within(markerLayer()).getByRole("button", { name }));
const markerChecked = (name: string) => within(markerLayer()).getByRole("checkbox", { name: `选择这个圣地: ${name}` }).getAttribute("aria-checked");

function Surfaces() {
  const selection = useSpotSelectionState();
  return <SpotSelectionProvider selection={selection}>
    <SpotCardGrid spots={spots} dict={dict} />
    <SelectableSpotMap spots={spots} dict={dict} attach={attachReady} />
  </SpotSelectionProvider>;
}

function SwitchableView({ view }: Readonly<{ view: "photos" | "map" }>) {
  const selection = useSpotSelectionState();
  return <SpotSelectionProvider selection={selection}>
    {view === "photos" ? <SpotCardGrid spots={spots} dict={dict} /> : <SelectableSpotMap spots={spots} dict={dict} attach={attachReady} />}
  </SpotSelectionProvider>;
}

describe("one selection behind photo cards and map markers", () => {
  it("shows a photo-card selection on the matching marker only", () => {
    render(<Surfaces />);
    fireEvent.click(cardPick("宇治橋"));
    expect(cardSelected("宇治橋")).toBe("true");
    openPin("宇治橋");
    expect(markerChecked("宇治橋")).toBe("true");
    openPin("京阪宇治駅");
    expect(markerChecked("京阪宇治駅")).toBe("false");
  });

  it("deselecting from the marker clears the photo card", () => {
    render(<Surfaces />);
    fireEvent.click(cardPick("宇治橋"));
    openPin("宇治橋");
    fireEvent.click(within(markerLayer()).getByRole("checkbox", { name: "选择这个圣地: 宇治橋" }));
    expect(cardSelected("宇治橋")).toBe("false");
    expect(markerChecked("宇治橋")).toBe("false");
  });

  it("switching between photo and map views never changes the selection", () => {
    const view = render(<SwitchableView view="photos" />);
    fireEvent.click(cardPick("宇治橋"));
    view.rerender(<SwitchableView view="map" />);
    openPin("宇治橋");
    expect(markerChecked("宇治橋")).toBe("true");
    view.rerender(<SwitchableView view="photos" />);
    expect(cardSelected("宇治橋")).toBe("true");
    expect(cardSelected("京阪宇治駅")).toBe("false");
  });

  it("labels a selected marker for assistive technology without a photo card", () => {
    const view: RenderResult = render(<SwitchableView view="map" />);
    openPin("宇治橋");
    fireEvent.click(within(markerLayer()).getByRole("checkbox", { name: "选择这个圣地: 宇治橋" }));
    expect(within(markerLayer()).getByText("已选 1 处")).toBeTruthy();
    view.rerender(<SwitchableView view="photos" />);
    expect(cardSelected("宇治橋")).toBe("true");
  });

  it("degrades to the offline map fallback when the basemap fails", () => {
    render(<SelectableSpotMap spots={spots} dict={dict} attach={attachFailing} />);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    expect(document.querySelector(".chat-search-map__gl")).toBeNull();
    expect(document.querySelector(".chat-search-map__overlay")).toBeNull();
  });
});
