/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", async () => (await import("./maplibre-adapter-fixture")).maplibreModule);

vi.mock("pmtiles", () => ({
  Protocol: class {
    readonly tile = () => ({ data: new ArrayBuffer(0) });
  },
}));

import { attachMapLibre, mountMapLibre } from "../../src/features/maplibre/maplibre-adapter";
import { fakeMaps, firstMap, mountOptions, resetFakeMaps } from "./maplibre-adapter-fixture";

beforeEach(resetFakeMaps);

describe("MapLibre v5 adapter lifecycle", () => {
  it("reports ready, removes listeners/resources, and makes destroy idempotent", async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    const cleanup = vi.fn();
    const handle = await mountMapLibre(mountOptions(onError, onReady, () => cleanup));
    const map = firstMap();

    map.emit("load");
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    handle.destroy();
    handle.destroy();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(map.offCalls).toBe(2);
    expect(map.removeCalls).toBe(1);
  });

  it("turns an error into one fallback and never reports ready after failure", async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    const handle = await mountMapLibre(mountOptions(onError, onReady));
    const map = firstMap();

    map.emit("error");
    map.emit("error");
    map.emit("load");

    expect(onError).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect(map.removeCalls).toBe(1);
    handle.destroy();
  });

  it("cleans a loaded map when the ready callback fails", async () => {
    const onError = vi.fn();
    const cleanup = vi.fn();
    const onReady = (): void => { throw new Error("ready callback failed"); };
    const onLoad = (): (() => void) => cleanup;
    const handle = await mountMapLibre(mountOptions(onError, onReady, onLoad));
    const map = firstMap();

    map.emit("load");

    expect(onError).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(map.removeCalls).toBe(1);
    handle.destroy();
  });
});

describe("MapLibre v5 teardown", () => {
  it("contains map teardown failures", async () => {
    fakeMaps.throwOnRemove = true;
    const handle = await mountMapLibre(mountOptions(vi.fn(), vi.fn()));

    expect(() => { handle.destroy(); }).not.toThrow();
  });
});

it("handles duplicate load events once", async () => {
  const onLoad = vi.fn(() => undefined);
  const onReady = vi.fn();
  const handle = await mountMapLibre(mountOptions(vi.fn(), onReady, onLoad));
  const map = firstMap();
  map.emit("load");
  map.emit("load");
  expect(onLoad).toHaveBeenCalledOnce();
  expect(onReady).toHaveBeenCalledOnce();
  handle.destroy();
});

describe("MapLibre v5 adapter failure handling", () => {
  it("reports constructor failure through the attachment fallback path", async () => {
    fakeMaps.throwOnConstruct = true;
    const onError = vi.fn();
    const detach = attachMapLibre(mountOptions(onError, vi.fn()));

    await vi.waitFor(() => { expect(onError).toHaveBeenCalledOnce(); });
    detach();
  });

  it("destroys a handle that resolves after React already detached", async () => {
    const detach = attachMapLibre(mountOptions(vi.fn(), vi.fn()));
    detach();

    await vi.waitFor(() => { expect(fakeMaps.instances[0]?.removeCalls).toBe(1); });
    expect(fakeMaps.instances[0]?.offCalls).toBe(2);
  });
});
