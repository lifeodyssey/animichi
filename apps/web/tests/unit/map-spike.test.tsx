/**
 * @vitest-environment jsdom
 */

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapSpike, type MapStatus } from "../../src/features/map-spike/MapSpike";
import type { SourceMode } from "../../src/features/map-spike/sourceMode";

afterEach(cleanup);

const renderSpike = (status: MapStatus, sourceMode: SourceMode = "pmtiles") => {
  const ref = createRef<HTMLDivElement>();
  return render(<MapSpike mapContainerRef={ref} status={status} sourceMode={sourceMode} />);
};

describe("MapSpike", () => {
  it("renders the dev-spike heading and description", () => {
    renderSpike("loading");
    expect(screen.getByRole("heading", { name: "Map spike" })).toBeTruthy();
    expect(screen.getByText(/MapLibre GL \+ Protomaps/)).toBeTruthy();
  });

  it.each([
    ["loading", "Loading Uji tiles…"],
    ["ready", "Interactive map ready."],
    ["fallback", "Showing the illustrated basemap — tiles are unavailable."],
  ] as const)("announces the %s status", (status, message) => {
    renderSpike(status);
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("shows the active tile source", () => {
    renderSpike("ready", "worker");
    expect(screen.getByText("Tile source: worker")).toBeTruthy();
  });

  it("always renders the illustrated basemap as the branded fallback layer", () => {
    renderSpike("fallback");
    expect(screen.getByRole("img", { name: "宇治エリアの巡礼ルート図" })).toBeTruthy();
    expect(screen.getByText("出")).toBeTruthy();
    expect(screen.getByText("★")).toBeTruthy();
  });

  it("hides the GL layer from assistive tech until the map is ready", () => {
    const { container } = renderSpike("loading");
    const gl = container.querySelector(".map-spike__gl");
    expect(gl?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes the GL layer once the map is ready", () => {
    const { container } = renderSpike("ready");
    const gl = container.querySelector(".map-spike__gl");
    expect(gl?.getAttribute("aria-hidden")).toBe("false");
  });
});
