/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShioriSource } from "../../../src/features/shiori/compose";
import { ShioriGenerator } from "../../../src/features/shiori/ShioriGenerator";
import { makeItinerary, makeMeta, makePhotos } from "./_factories";

afterEach(cleanup);

function makeSource(overrides: Partial<ShioriSource> = {}): ShioriSource {
  return {
    meta: makeMeta(),
    itinerary: makeItinerary(),
    photos: makePhotos(1),
    checkedStopIds: [],
    isRouteDayOver: false,
    ...overrides,
  };
}

const COMPLETED = { checkedStopIds: ["stop-station", "stop-shrine"] };

describe("ShioriGenerator", () => {
  it("auto-generates a commemorative preview with completion stats", () => {
    render(<ShioriGenerator source={makeSource(COMPLETED)} locale="ja" />);

    expect(screen.getByRole("heading", { name: "完走記念しおり" })).toBeTruthy();
    expect(screen.getByText("徒歩210分 · 2.8km · 09:31→12:58")).toBeTruthy();
    expect(screen.getByText("完走 2/2 · 100%")).toBeTruthy();
    expect(screen.getByRole("article", { name: "完走記念しおり" })).toBeTruthy();
  });

  it("auto-generates a planned preview without completion stats", () => {
    render(<ShioriGenerator source={makeSource()} locale="ja" />);

    expect(screen.getByRole("heading", { name: "計画しおり" })).toBeTruthy();
    expect(screen.queryByText("完走 2/2 · 100%")).toBeNull();
    expect(screen.getByRole("article", { name: "計画しおり" })).toBeTruthy();
  });

  it("still renders a valid planned preview for zero check-ins on a past day", () => {
    render(
      <ShioriGenerator source={makeSource({ photos: [], isRouteDayOver: true })} locale="ja" />,
    );

    expect(screen.getByRole("heading", { name: "計画しおり" })).toBeTruthy();
    expect(screen.getByText("飛騨古川駅")).toBeTruthy();
  });

  it.each([
    ["zh", "完走纪念书签"],
    ["en", "Commemorative shiori"],
  ] as const)("renders the %s mode label", (locale, heading) => {
    render(<ShioriGenerator source={makeSource(COMPLETED)} locale={locale} />);

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
  });

  it("keeps EXIF stripping on by default", () => {
    render(<ShioriGenerator source={makeSource()} locale="ja" />);

    const optIn = screen.getByRole("checkbox", { name: "写真の位置情報（EXIF）を残す" });
    expect((optIn as HTMLInputElement).checked).toBe(false);
  });

  it("reports the opt-in when the user chooses to retain EXIF", () => {
    const onRetainExifChange = vi.fn();
    render(
      <ShioriGenerator source={makeSource()} locale="en" onRetainExifChange={onRetainExifChange} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep photo location data (EXIF)" }));

    expect(onRetainExifChange).toHaveBeenCalledWith(true);
    const optIn = screen.getByRole("checkbox", { name: "Keep photo location data (EXIF)" });
    expect((optIn as HTMLInputElement).checked).toBe(true);
  });
});
