import { expect, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

type Listener = (...args: readonly unknown[]) => void;

export interface FakeMapInstance {
  emit: (type: string) => void;
  offCalls: number;
  options: unknown;
  removeCalls: number;
}

/** Mutable mount state shared by the mock module and the test body. */
export const fakeMaps = {
  instances: [] as FakeMapInstance[],
  throwOnConstruct: false,
  throwOnRemove: false,
};

class FakeMap {
  readonly listeners = new globalThis.Map<string, Listener[]>();
  readonly options: unknown;
  removeCalls = 0;
  offCalls = 0;

  constructor(options: unknown) {
    if (fakeMaps.throwOnConstruct) throw new Error("WebGL context unavailable");
    this.options = options;
    fakeMaps.instances.push(this);
  }

  on(type: string, listener: Listener): this {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
    return this;
  }

  off(type: string, listener: Listener): this {
    this.offCalls += 1;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    return this;
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({});
  }

  remove(): void {
    this.removeCalls += 1;
    if (fakeMaps.throwOnRemove) throw new Error("Map removal failed");
  }

  getContainer(): HTMLElement {
    return (this.options as { container: HTMLElement }).container;
  }
}

/** Drop-in for the `maplibre-gl` module; each test file wires it with `vi.mock`. */
export const maplibreModule = {
  Map: FakeMap,
  addProtocol: vi.fn(),
  removeProtocol: vi.fn(),
  setWorkerUrl: vi.fn(),
};

export function resetFakeMaps(): void {
  fakeMaps.instances.length = 0;
  fakeMaps.throwOnConstruct = false;
  fakeMaps.throwOnRemove = false;
  maplibreModule.removeProtocol.mockClear();
}

export const MAP_STYLE = { version: 8, sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f8f0" } }],
} satisfies StyleSpecification;

export function mountOptions(onError: () => void, onReady: () => void, onLoad?: () => (() => void) | undefined) {
  return {
    container: document.createElement("div"),
    onError,
    onReady,
    onLoad,
    registerPmtiles: true,
    style: MAP_STYLE,
  };
}

export function firstMap(): FakeMapInstance {
  expect(fakeMaps.instances).toHaveLength(1);
  return fakeMaps.instances.reduce((map) => map);
}
