/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

vi.mock("maplibre-gl", async () => (await import("./maplibre-adapter-fixture")).maplibreModule);

vi.mock("pmtiles", () => ({
  Protocol: class {
    readonly tile = () => ({ data: new ArrayBuffer(0) });
  },
}));

import { mountMapLibre } from "../../src/features/maplibre/maplibre-adapter";
import { MAP_STYLE, firstMap, mountOptions, resetFakeMaps } from "./maplibre-adapter-fixture";

beforeEach(resetFakeMaps);

describe("MapLibre v5 compact attribution", () => {
  it("collapses the initially-expanded compact attribution once the map is ready", async () => {
    const container = document.createElement("div");
    const control = document.createElement("div");
    control.className = "maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show";
    control.setAttribute("open", "");
    container.appendChild(control);
    const onReady = vi.fn();
    const handle = await mountMapLibre({ ...mountOptions(vi.fn(), onReady), container });

    firstMap().emit("load");

    expect(onReady).toHaveBeenCalledOnce();
    expect(control.classList.contains("maplibregl-compact-show")).toBe(false);
    expect(control.hasAttribute("open")).toBe(false);
    handle.destroy();
  });
});

describe("MapLibre v5 style asset URLs", () => {
  it("resolves style assets and initializes the camera before loading", async () => {
    const style = {
      ...MAP_STYLE,
      sprite: "/tiles/sprites/v4/light",
      glyphs: "/tiles/fonts/{fontstack}/{range}.pbf",
    } satisfies StyleSpecification;
    const bounds: [[number, number], [number, number]] = [[135.8, 34.89], [135.82, 34.9]];
    const fitBoundsOptions = { padding: 36, maxZoom: 15, animate: false };
    await mountMapLibre({ ...mountOptions(vi.fn(), vi.fn()), style, bounds, fitBoundsOptions });
    expect(firstMap().options).toMatchObject({ bounds, fitBoundsOptions });

    const mounted = firstMap().options as { style: StyleSpecification };
    expect(mounted.style.sprite).toBe(`${window.location.origin}/tiles/sprites/v4/light`);
    expect(mounted.style.glyphs).toBe(`${window.location.origin}/tiles/fonts/{fontstack}/{range}.pbf`);
  });
});
