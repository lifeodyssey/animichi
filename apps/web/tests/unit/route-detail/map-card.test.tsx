/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapCard } from "../../../src/features/route-detail/components/MapCard";
import type { MapCardPayload } from "../../../src/features/route-detail/components/MapCard";
import { routeDetailCopyFor } from "../../../src/features/route-detail/lib/copy";
import { ROUTE_DETAIL_SCHEMA_VERSION } from "../../../src/features/route-detail/lib/data-state";

afterEach(cleanup);

const copy = routeDetailCopyFor("ja");

function payload(overrides: Partial<MapCardPayload> = {}): MapCardPayload {
  return {
    schema_version: ROUTE_DETAIL_SCHEMA_VERSION,
    pins: [{ id: "a", label: "1", state: "visited" }],
    progress: "1/5",
    ...overrides,
  };
}

function mapRegion(): HTMLElement {
  return screen.getByRole("region", { name: "地図" });
}

/**
 * The mode the map is IN, as the accessibility tree carries it. A `<section>`
 * with a name is an implicit `region`, and `region` does not support
 * `aria-expanded`; the toggle's `aria-pressed` is the supported expression of
 * the same state, so it is the one this suite reads.
 */
function modePressed(label: string): string | null {
  return screen.getByRole("button", { name: label }).getAttribute("aria-pressed");
}

/** The stage the stylesheet sizes by mode, if it is in the given mode. */
function stageInMode(mode: string): Element | null {
  return mapRegion().querySelector(`.route-map__stage[data-mode="${mode}"]`);
}

describe("MapCard generative component", () => {
  it("shows the gold route pill with N/total progress", () => {
    render(<MapCard payload={payload()} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(screen.getByLabelText(copy.progressAria).textContent).toBe("1/5");
  });

  it("reflects the expanded mode on the toggle and on the stage", () => {
    render(<MapCard payload={payload()} copy={copy} mode="expanded" onToggle={vi.fn()} />);
    expect(modePressed(copy.mapCollapse)).toBe("true");
    expect(stageInMode("expanded")).not.toBeNull();
  });

  it("stays collapsed in idle mode", () => {
    render(<MapCard payload={payload()} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(modePressed(copy.mapExpand)).toBe("false");
    expect(stageInMode("idle")).not.toBeNull();
  });

  it("never puts aria-expanded on the region, which does not support it", () => {
    render(<MapCard payload={payload()} copy={copy} mode="expanded" onToggle={vi.fn()} />);
    expect(mapRegion().hasAttribute("aria-expanded")).toBe(false);
  });

  it("leaves the stage's height to the stylesheet rather than an inline style", () => {
    render(<MapCard payload={payload()} copy={copy} mode="expanded" onToggle={vi.fn()} />);
    expect(stageInMode("expanded")?.getAttribute("style")).toBeNull();
  });

  it("requests a toggle when the mode control is pressed", () => {
    const onToggle = vi.fn();
    render(<MapCard payload={payload()} copy={copy} mode="idle" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: copy.mapExpand }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("renders the skeleton slot instead of crashing when pins are missing", () => {
    render(<MapCard payload={{ schema_version: ROUTE_DETAIL_SCHEMA_VERSION }} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "地図" })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("tolerates a legacy payload missing progress by hiding the pill", () => {
    render(<MapCard payload={payload({ schema_version: 0, progress: undefined })} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(screen.queryByLabelText(copy.progressAria)).toBeNull();
    expect(mapRegion()).toBeTruthy();
  });
});
