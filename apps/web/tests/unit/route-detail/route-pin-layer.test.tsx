/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoutePinLayer } from "../../../src/components/route-detail/RoutePinLayer";
import { routeDetailCopyFor } from "../../../src/lib/route-detail/copy";
import type { RoutePin } from "../../../src/lib/route-detail/pinState";

afterEach(cleanup);

const copy = routeDetailCopyFor("ja");

const PINS: readonly RoutePin[] = [
  { id: "a", label: "1", state: "visited" },
  { id: "b", label: "2", state: "current" },
  { id: "c", label: "3", state: "unvisited" },
];

function pin(name: string): HTMLElement {
  return screen.getByRole("listitem", { name });
}

describe("RoutePinLayer map-pin language", () => {
  it("renders each pin with its data state", () => {
    render(<RoutePinLayer pins={PINS} copy={copy} />);
    expect(pin(`${copy.pinVisited} 1`).getAttribute("data-state")).toBe("visited");
    expect(pin(`${copy.pinCurrent} 2`).getAttribute("data-state")).toBe("current");
    expect(pin(`${copy.pinUnvisited} 3`).getAttribute("data-state")).toBe("unvisited");
  });

  it("overlays ✓ on visited and ★ on current, keeps the number on unvisited", () => {
    render(<RoutePinLayer pins={PINS} copy={copy} />);
    expect(pin(`${copy.pinVisited} 1`).textContent).toBe("✓");
    expect(pin(`${copy.pinCurrent} 2`).textContent).toBe("★");
    expect(pin(`${copy.pinUnvisited} 3`).textContent).toBe("3");
  });

  it("swells the current pin to 58px", () => {
    render(<RoutePinLayer pins={PINS} copy={copy} />);
    expect(pin(`${copy.pinCurrent} 2`).style.width).toBe("58px");
    expect(pin(`${copy.pinUnvisited} 3`).style.width).toBe("48px");
  });

  it("renders nothing but the empty list when there are no pins", () => {
    render(<RoutePinLayer pins={[]} copy={copy} />);
    expect(screen.getByRole("list", { name: "ピン" }).childElementCount).toBe(0);
  });
});
