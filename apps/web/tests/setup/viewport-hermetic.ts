import { beforeEach, vi } from "vitest";

const MAX_WIDTH_PX = /\(max-width:\s*(\d+)px\)/;

function matchViewportQuery(query: string): MediaQueryList {
  const limit = Number(MAX_WIDTH_PX.exec(query)?.[1] ?? 0);
  return Object.assign(new EventTarget(), {
    matches: window.innerWidth <= limit,
    media: query,
    onchange: null,
  }) as MediaQueryList;
}

class ResizeObserverStub {
  observe(): void { return undefined; }
  unobserve(): void { return undefined; }
  disconnect(): void { return undefined; }
}

// jsdom ships no matchMedia; the viewport-driven stub keeps the CSS breakpoint
// and the JS breakpoint reading the same number in tests.
beforeEach(() => {
  if (typeof window === "undefined") return;
  window.innerWidth = 1024;
  window.matchMedia = matchViewportQuery;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
