/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { toSearchSpots } from "../../../src/features/chat/lib/spot-clusters";
import type { SpotRowLike } from "../../../src/features/chat/lib/spot-clusters";

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
  it("explains missing coordinates without calling existing spots an empty result", () => {
    renderResult([{ id: "a", name: "無座標の聖地" }]);
    expect(document.querySelector('[data-fallback="D2"]')).toBeTruthy();
    expect(screen.getByText(dict.errorStates.d2UnlocatedTitle)).toBeTruthy();
    expect(screen.queryByText(dict.errorStates.d2Title)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector(".chat-search-map")).toBeNull();
  });

  it("still lists the coordinate-less spots as cards next to the D2 state", () => {
    renderResult([{ id: "a", name: "無座標の聖地" }]);
    expect(screen.getByText("無座標の聖地")).toBeTruthy();
  });

  it("offers a new search only when the result actually has no spots", () => {
    renderResult([]);
    expect(screen.getByText(dict.errorStates.d2Title)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: dict.errorStates.d2Label })).toBeTruthy();
    expect(screen.queryByText(dict.errorStates.d2UnlocatedTitle)).toBeNull();
  });
});

describe("map load failure (AC: D7 fallback + external map link)", () => {
  const located = [
    { id: "u1", name: "宇治橋", lat: 34.89, lng: 135.8 },
    { id: "u2", name: "京阪宇治駅", lat: 34.9, lng: 135.81 },
  ];

  it("degrades the C3a static map to the D7 placeholder with the map-app link", () => {
    renderResult(located, attachBroken);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    const link = screen.getByRole("link", { name: dict.errorStates.d7Open });
    expect(link.getAttribute("href")).toContain("34.89,135.8");
    expect(document.querySelector(".chat-search-map__gl")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(dict.errorStates.d7Message);
  });

  it("degrades the C3b bubble map the same way", () => {
    renderResult([...located, { id: "t1", name: "須賀神社", lat: 35.69, lng: 139.7 }], attachBroken);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    expect(screen.getByRole("link", { name: dict.errorStates.d7Open })).toBeTruthy();
    expect(document.querySelectorAll(".chat-map-bubble")).toHaveLength(0);
  });
});
