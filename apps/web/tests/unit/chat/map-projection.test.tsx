/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MountBasemapOptions } from "../../../src/features/bubble-map/bubble-map-controller";
import { StaticSpotMap } from "../../../src/features/chat/components/SearchMap";
import { RouteTrailMap } from "../../../src/features/chat/components/RouteTrailMap";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const dict = chatDictFor("ja");
const spots = [
  { id: "bridge", name: "宇治橋", coord: { lat: 34.893, lng: 135.8077 } },
  { id: "shrine", name: "宇治神社", coord: { lat: 34.8918, lng: 135.8118 } },
] as const;
const positions = [{ leftPct: 38, topPct: 42 }, { leftPct: 65, topPct: 57 }] as const;

function viewport() {
  let mounted: MountBasemapOptions | undefined;
  const cleanupMap = vi.fn();
  const attach = vi.fn((options: MountBasemapOptions) => { mounted = options; return cleanupMap; });
  return { attach, cleanupMap, project: (next: Parameters<NonNullable<MountBasemapOptions["onProject"]>>[0] = positions) => { mounted?.onProject?.(next); mounted?.onStatus("ready"); } };
}

it("waits for the map projection and moves pins with the viewport", () => {
  const map = viewport();
  render(<StaticSpotMap spots={spots} dict={dict} attach={map.attach} maxPins={50} />);
  expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(0);
  act(() => { map.project(); });
  const pin = document.querySelector<HTMLElement>(".chat-map-pin");
  expect([pin?.style.left, pin?.style.top]).toEqual(["38%", "42%"]);
  act(() => { map.project([{ leftPct: 45, topPct: 30 }, positions[1]]); });
  expect([pin?.style.left, pin?.style.top]).toEqual(["45%", "30%"]);
});

it("binds route numbers and the connecting line to the basemap projection", () => {
  const map = viewport();
  render(<RouteTrailMap stations={spots} dimmed={[]} dict={dict} attach={map.attach} />);
  act(() => { map.project(); });
  const pins = [...document.querySelectorAll<HTMLElement>(".chat-route-pin")];
  expect(pins.map((pin) => [pin.textContent, pin.style.left, pin.style.top])).toEqual([["1", "38%", "42%"], ["2", "65%", "57%"]]);
  expect(document.querySelector("polyline")?.getAttribute("points")).toBe("38,42 65,57");
});

it("keeps the live map for equivalent streaming props and cleans it up on unmount", () => {
  const map = viewport();
  const view = render(<StaticSpotMap spots={spots} dict={dict} attach={map.attach} maxPins={50} />);
  act(() => { map.project(); });
  view.rerender(<StaticSpotMap spots={spots.map((spot) => ({ ...spot }))} dict={dict} attach={map.attach} maxPins={50} />);
  expect(map.attach).toHaveBeenCalledTimes(1);
  expect(map.cleanupMap).not.toHaveBeenCalled();
  view.unmount();
  expect(map.cleanupMap).toHaveBeenCalledTimes(1);
});

it("clears old projected pins when new coordinates need a new map", () => {
  const map = viewport();
  const view = render(<StaticSpotMap spots={spots} dict={dict} attach={map.attach} maxPins={50} />);
  act(() => { map.project(); });
  view.rerender(<StaticSpotMap spots={[{ ...spots[0], coord: { lat: 35.685, lng: 139.72 } }]} dict={dict} attach={map.attach} maxPins={50} />);
  expect(map.cleanupMap).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(0);
  act(() => { map.project([{ leftPct: 50, topPct: 50 }]); });
  expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(1);
});
