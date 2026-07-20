/**
 * @vitest-environment jsdom
 */
import type { AnimeOverviewCircle } from "@seichijunrei/contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CircleBubbleMap } from "../../../src/features/bubble-map/CircleBubbleMap";
import { bubbleMapCopyFor } from "../../../src/features/bubble-map/copy";

afterEach(cleanup);

const copy = bubbleMapCopyFor("en");

const CIRCLES: readonly AnimeOverviewCircle[] = [
  { region: "Tokyo", count: 2, lat: 35.68, lng: 139.76 },
  { region: "Takayama", count: 6, lat: 36.14, lng: 137.25 },
];

function renderMap(circles: readonly AnimeOverviewCircle[], onSelect = vi.fn()) {
  render(
    <CircleBubbleMap
      circles={circles}
      copy={copy}
      selectedRegion={null}
      onSelectRegion={onSelect}
      mapContainerRef={createRef<HTMLDivElement>()}
    />,
  );
  return onSelect;
}

describe("CircleBubbleMap bubbles", () => {
  it("renders one bubble per region with its spot count", () => {
    renderMap(CIRCLES);
    expect(screen.getByRole("button", { name: /Tokyo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Takayama/ })).toBeTruthy();
  });

  it("sizes the busier region's bubble larger than the quieter one", () => {
    renderMap(CIRCLES);
    const tokyo = screen.getByRole("button", { name: /Tokyo/ });
    const takayama = screen.getByRole("button", { name: /Takayama/ });
    const size = (el: HTMLElement) => Number.parseFloat(el.style.width);
    expect(size(takayama)).toBeGreaterThan(size(tokyo));
  });

  it("renders a single bubble when every spot is in one region", () => {
    renderMap([{ region: "Uji", count: 4, lat: 34.88, lng: 135.8 }]);
    expect(screen.getByRole("button", { name: /Uji/ })).toBeTruthy();
    expect(screen.queryByText(copy.empty)).toBeNull();
  });

  it("shows the empty state instead of a blank map when there are no regions", () => {
    renderMap([]);
    expect(screen.getByText(copy.empty)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CircleBubbleMap interaction", () => {
  it("reports the tapped region to the caller", async () => {
    const onSelect = renderMap(CIRCLES);
    await userEvent.click(screen.getByRole("button", { name: /Takayama/ }));
    expect(onSelect).toHaveBeenCalledWith("Takayama");
  });
});
