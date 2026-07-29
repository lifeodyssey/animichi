/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { toSearchSpots } from "../../../src/lib/chat/spotClusters";
import type { SpotRowLike } from "../../../src/lib/chat/spotClusters";

afterEach(cleanup);

const dict = chatDictFor("ja");
const attachBroken: AttachBasemap = ({ onStatus }) => {
  onStatus("fallback");
  return () => undefined;
};

function renderResult(rows: readonly SpotRowLike[], attach?: AttachBasemap) {
  return render(
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <SearchResult spots={toSearchSpots(rows)} dict={dict} attach={attach} />
    </ChatActionsProvider>,
  );
}

describe("empty map view (AC: D2 state, never a silently empty map)", () => {
  it("renders the D2 zero-spots state when no spot carries coordinates", () => {
    renderResult([{ id: "a", name: "無座標の聖地" }]);
    expect(document.querySelector('[data-fallback="D2"]')).toBeTruthy();
    expect(screen.getByText(dict.errorStates.d2Title)).toBeTruthy();
    expect(document.querySelector(".chat-search-map")).toBeNull();
  });

  it("still lists the coordinate-less spots as cards next to the D2 state", () => {
    renderResult([{ id: "a", name: "無座標の聖地" }]);
    expect(screen.getByText("無座標の聖地")).toBeTruthy();
  });
});

describe("map load failure (AC: D7 doodle + external map link)", () => {
  const located = [
    { id: "u1", name: "宇治橋", lat: 34.89, lng: 135.8 },
    { id: "u2", name: "京阪宇治駅", lat: 34.9, lng: 135.81 },
  ];

  it("degrades the C3a static map to the D7 placeholder with the map-app link", () => {
    renderResult(located, attachBroken);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    const link = screen.getByRole("link", { name: "地図アプリで開く" });
    expect(link.getAttribute("href")).toContain("34.89,135.8");
    expect(document.querySelector(".chat-search-map__gl")).toBeNull();
    expect(document.querySelector(".chat-map-fallback__doodle")).toBeTruthy();
  });

  it("degrades the C3b bubble map the same way", () => {
    renderResult([...located, { id: "t1", name: "須賀神社", lat: 35.69, lng: 139.7 }], attachBroken);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    expect(screen.getByRole("link", { name: dict.errorStates.d7Open })).toBeTruthy();
    expect(document.querySelectorAll(".chat-map-bubble")).toHaveLength(0);
  });
});
