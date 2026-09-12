/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItineraryDraft } from "../../../src/features/chat/components/ItineraryDraft";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { draftStayCopy } from "../../../src/features/chat/itinerary-draft-copy";
import { draftFixture } from "./itinerary-draft-fixture";

afterEach(cleanup);
const props = { draft: draftFixture, dict: chatDictFor("zh"), onSave: vi.fn(), onAdjust: vi.fn() };

describe("missing content does not erase itinerary places", () => {
  it("retains places with no scene images or viewpoints", () => {
    render(<ItineraryDraft {...props} draft={{ ...draftFixture, stops: draftFixture.stops.map((stop) => ({ ...stop, place: { ...stop.place, viewpoints: [] } })) }} />);
    expect(screen.getByRole("heading", { name: "須賀神社 男坂" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "参宮橋 1号踏切" })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "暂无场景图片" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "保存草案" })).toBeTruthy();
  });

  it("replaces a failed thumbnail without dropping the place or other viewpoints", () => {
    render(<ItineraryDraft {...props} />);
    fireEvent.error(screen.getByRole("img", { name: "須賀神社 男坂" }));
    expect(screen.getByRole("img", { name: "暂无场景图片" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "須賀神社 男坂" })).toBeTruthy();
  });

  it("offers adjustment instead of saving an empty draft", () => {
    const onAdjust = vi.fn();
    render(<ItineraryDraft {...props} draft={{ ...draftFixture, stops: [] }} onAdjust={onAdjust} />);
    expect(screen.getByText("这份草案还没有地点")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存草案" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onAdjust).toHaveBeenCalledExactlyOnceWith("draft-a");
  });
});

describe("localized and honest estimate presentation", () => {
  it("uses singular English for a one-place plan", () => {
    render(<ItineraryDraft {...props} dict={chatDictFor("en")} draft={{ ...draftFixture, stops: draftFixture.stops.slice(0, 1) }} />);
    expect(screen.getByText("1 place")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place details: 須賀神社 男坂" }));
    expect(screen.getByText("Suggested stay: about 20–40 min")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });

  it("localizes Japanese controls and reference times", () => {
    render(<ItineraryDraft {...props} dict={chatDictFor("ja")} />);
    fireEvent.click(screen.getByRole("button", { name: "場所の詳細: 須賀神社 男坂" }));
    expect(screen.getByText("滞在の目安：約20–40分")).toBeTruthy();
    expect(screen.getByRole("button", { name: "この案を保存" })).toBeTruthy();
  });

  it("omits inverted, nonfinite and nonpositive estimates", () => {
    expect(draftStayCopy("zh", { minMinutes: 30, maxMinutes: 20 })).toBeNull();
    expect(draftStayCopy("zh", { minMinutes: 0, maxMinutes: 10 })).toBeNull();
    expect(draftStayCopy("zh", { minMinutes: 10, maxMinutes: Number.NaN })).toBeNull();
    expect(draftStayCopy("zh")).toBeNull();
  });
});
