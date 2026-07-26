/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { toSearchSpots } from "../../../src/lib/chat/spotClusters";
import type { SpotRowLike } from "../../../src/lib/chat/spotClusters";

afterEach(cleanup);

const dict = chatDictFor("ja");
const attachReady: AttachBasemap = ({ onStatus }) => {
  onStatus("ready");
  return () => undefined;
};

function ujiRow(index: number, screenshot?: string): SpotRowLike {
  return {
    id: `p${String(index)}`,
    name: `spot-${String(index)}`,
    lat: 34.89 + index * 0.001,
    lng: 135.8,
    screenshot_url: screenshot,
    ep: 8,
  };
}

function renderSingle(rows: readonly SpotRowLike[]) {
  return render(<SearchResult spots={toSearchSpots(rows)} dict={dict} attach={attachReady} />);
}

describe("C3a spot cards (AC: top-6 cards, cover + episode tag + checkbox)", () => {
  it("renders at most six cards, photo-carrying spots first", () => {
    const rows = [ujiRow(0), ...Array.from({ length: 7 }, (_, i) => ujiRow(i + 1, `/s${String(i + 1)}.webp`))];
    renderSingle(rows);
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(screen.queryByText("spot-0")).toBeNull();
    expect(screen.getByText("spot-1")).toBeTruthy();
  });

  it("shows the screenshot cover, episode tag, and a labelled checkbox on each card", () => {
    renderSingle([ujiRow(1, "/s1.webp"), ujiRow(2, "/s2.webp")]);
    expect(document.querySelectorAll("img.chat-scene-thumb")).toHaveLength(2);
    expect(screen.getAllByText("第8話")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: `${dict.search.select}: spot-1` })).toBeTruthy();
  });
});

describe("C3a static map (AC: static map with ≤50 pins)", () => {
  it("mounts the basemap container with one pin per spot", () => {
    renderSingle([ujiRow(1, "/s1.webp"), ujiRow(2, "/s2.webp"), ujiRow(3)]);
    expect(document.querySelector(".chat-search-map__gl")).toBeTruthy();
    expect(screen.getByRole("img", { name: dict.search.mapLabel })).toBeTruthy();
    expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(3);
  });

  it("never draws more than fifty pins even for a sixty-spot cluster", () => {
    renderSingle(Array.from({ length: 60 }, (_, index) => ujiRow(index, "/s.webp")));
    expect(document.querySelectorAll(".chat-map-pin")).toHaveLength(50);
  });
});
