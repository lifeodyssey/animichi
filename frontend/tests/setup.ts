import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./mocks/server";
import { beforeAll, afterEach, afterAll } from "vitest";

// Set the runtime URL to match MSW handlers' base URL
process.env.NEXT_PUBLIC_RUNTIME_URL = "http://localhost:8000";

// jsdom polyfills for browser APIs used by components.
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor -- jsdom browser-API stubs: these methods/constructors must exist with the native signature but have no behaviour in tests. */
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(_cb: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

// scrollIntoView is not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = function () {};

// matchMedia polyfill — used by FoxGuide (prefers-reduced-motion)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Suppress mapbox-gl Worker error in jsdom (no WebGL/Worker support)
globalThis.Worker = class Worker {
  constructor() {}
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  onmessage = null;
  onerror = null;
} as unknown as typeof Worker;
/* eslint-enable @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor */

beforeAll(() => { server.listen({ onUnhandledRequest: "error" }); });
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => { server.close(); });
