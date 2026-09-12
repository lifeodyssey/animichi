/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdjustmentFixture } from "./draft-adjustment-fixture";
import { draftFixture } from "./itinerary-draft-fixture";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const stops = Array.from({ length: 30 }, (_, index) => ({ ...draftFixture.stops[0], place: { ...draftFixture.stops[0].place, id: `place-${String(index + 1)}`, name: `地点 ${String(index + 1).padStart(2, "0")}`, city: "样例地区" } }));
const draft = { ...draftFixture, stops };
const places = stops.map((stop) => stop.place);
const search = () => screen.getByRole("textbox", { name: "查找草案里的地点" });
const rows = () => within(screen.getByRole("list", { name: "建议游览顺序" }));

describe("a large draft stays complete while browsing", () => {
  it("shows every place compactly and opens only the requested details", () => {
    render(<AdjustmentFixture draft={draft} />);
    expect(rows().getAllByRole("heading")).toHaveLength(30);
    expect(screen.queryByText("留时间看看选中的画面。")).toBeNull();
    const first = rows().getByRole("button", { name: "地点详情: 地点 01" });
    const eighteenth = rows().getByRole("button", { name: "地点详情: 地点 18" });
    fireEvent.click(first);
    expect(screen.getByText("留时间看看选中的画面。")).toBeTruthy();
    fireEvent.click(eighteenth);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(eighteenth.getAttribute("aria-expanded")).toBe("true");
  });

  it("filters by normalized names or area without renumbering or changing the submitted selection", () => {
    const onSubmit = vi.fn(), onPlacesChange = vi.fn();
    render(<AdjustmentFixture draft={draft} value="晚点出发" onSubmit={onSubmit} onPlacesChange={onPlacesChange} />);
    fireEvent.change(search(), { target: { value: "１８" } });
    expect(rows().getAllByRole("listitem")).toHaveLength(1);
    expect(rows().getByRole("listitem").getAttribute("value")).toBe("18");
    expect(screen.getByText("找到 1 / 30 个地点")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新草案" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ draftId: "draft-a", instruction: "晚点出发", places });
    fireEvent.change(search(), { target: { value: "样例地区" } });
    expect(rows().getAllByRole("listitem")).toHaveLength(30);
    expect(onPlacesChange).not.toHaveBeenCalled();
  });
});

describe("editing and navigating a filtered draft", () => {
  it("removes and restores a filtered place without losing hidden places or the query", () => {
    const onSubmit = vi.fn();
    render(<AdjustmentFixture draft={draft} onSubmit={onSubmit} />);
    fireEvent.change(search(), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 地点 18" }));
    expect(screen.getByText("29 个地点")).toBeTruthy();
    expect(screen.getByText("没有找到，换个地点名或地区试试。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新草案" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ draftId: "draft-a", instruction: "", places: [...places.slice(0, 17), ...places.slice(18)] });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "查找草案里的地点" }).value).toBe("18");
    expect(rows().getByRole("listitem").getAttribute("value")).toBe("18");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "更新草案" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "清除查找" }));
    expect(rows().getAllByRole("heading").map((heading) => heading.textContent)).toEqual(places.map((place) => place.name));
  });

  it("restores the open place after clearing an unmatched search and keeps the search focused", () => {
    render(<AdjustmentFixture draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "地点详情: 地点 18" }));
    fireEvent.change(search(), { target: { value: "不存在" } });
    expect(rows().queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "清除查找" }));
    expect(screen.getByRole("button", { name: "地点详情: 地点 18" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search());
  });

  it("reaches the adjustment input directly without altering the draft", () => {
    const onPlacesChange = vi.fn();
    render(<AdjustmentFixture draft={draft} onPlacesChange={onPlacesChange} value="保留这些地点" />);
    fireEvent.click(screen.getByRole("button", { name: "写调整想法" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "调整想法" }));
    expect(onPlacesChange).not.toHaveBeenCalled();
    expect(rows().getAllByRole("listitem")).toHaveLength(30);
  });
});
