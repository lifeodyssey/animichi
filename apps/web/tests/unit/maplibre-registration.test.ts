/** @vitest-environment jsdom */

import { expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

const maplibre = vi.hoisted(() => {
  class FakeMap {
    on(): this { return this; }
    off(): this { return this; }
    remove(): void { this.off(); }
  }
  return { addProtocol: vi.fn(), FakeMap, removeProtocol: vi.fn() };
});

vi.mock("maplibre-gl", () => ({
  Map: maplibre.FakeMap,
  addProtocol: maplibre.addProtocol,
  removeProtocol: maplibre.removeProtocol,
}));

vi.mock("pmtiles", () => ({
  Protocol: class {
    readonly tile = () => ({ data: new ArrayBuffer(0) });
  },
}));

import { mountMapLibre } from "../../src/features/maplibre/maplibreAdapter";

const STYLE = { version: 8, sources: {}, layers: [] } satisfies StyleSpecification;

it("registers the shared PMTiles protocol only once across repeated mounts", async () => {
  const options = { container: document.createElement("div"), onError: vi.fn(), registerPmtiles: true, style: STYLE };
  const first = await mountMapLibre(options);
  const second = await mountMapLibre(options);
  expect(maplibre.addProtocol).toHaveBeenCalledOnce();
  first.destroy();
  second.destroy();
  expect(maplibre.removeProtocol).not.toHaveBeenCalled();
});
