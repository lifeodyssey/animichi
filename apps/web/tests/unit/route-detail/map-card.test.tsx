/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapCard } from "../../../src/components/route-detail/MapCard";
import type { MapCardPayload } from "../../../src/components/route-detail/MapCard";
import { routeDetailCopyFor } from "../../../src/lib/route-detail/copy";
import { ROUTE_DETAIL_SCHEMA_VERSION } from "../../../src/lib/route-detail/dataState";

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

describe("MapCard generative component", () => {
  it("shows the gold route pill with N/total progress", () => {
    render(<MapCard payload={payload()} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(screen.getByLabelText(copy.progressAria).textContent).toBe("1/5");
  });

  it("reflects the expanded mode on the map region", () => {
    render(<MapCard payload={payload()} copy={copy} mode="expanded" onToggle={vi.fn()} />);
    expect(mapRegion().getAttribute("aria-expanded")).toBe("true");
  });

  it("stays collapsed in idle mode", () => {
    render(<MapCard payload={payload()} copy={copy} mode="idle" onToggle={vi.fn()} />);
    expect(mapRegion().getAttribute("aria-expanded")).toBe("false");
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
