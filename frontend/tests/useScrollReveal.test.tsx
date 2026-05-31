import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

// Capture observed elements + the IO callback so we can simulate intersection.
let observed: Element[];
let ioCallback: IntersectionObserverCallback;

beforeEach(() => {
  observed = [];
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      ioCallback = cb;
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

function Probe() {
  const ref = useScrollReveal();
  return (
    <div data-testid="t" ref={ref}>
      hi
    </div>
  );
}

describe("useScrollReveal", () => {
  it("observes the element when the ref callback fires (no observer-vs-effect race)", () => {
    // Regression: the observer was previously created only in useEffect, which
    // runs AFTER ref callbacks during commit — leaving synchronously-rendered
    // elements unobserved and stuck at opacity:0. Lazy init fixes it.
    const { getByTestId } = render(<Probe />);
    expect(observed).toContain(getByTestId("t"));
  });

  it("adds seichi-visible once the element intersects the viewport", () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId("t");
    ioCallback(
      [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(el.classList.contains("seichi-visible")).toBe(true);
  });

  it("does not reveal an element that has not intersected", () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId("t");
    ioCallback(
      [{ isIntersecting: false, target: el } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(el.classList.contains("seichi-visible")).toBe(false);
  });
});
