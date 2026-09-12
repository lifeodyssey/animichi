/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDraftViewpoint, availableDraftPlaces, draftWithSelection, removeDraftViewpoint } from "../../../src/features/chat/lib/draft-adjustment";
import { nativeDialogFixture } from "./dialog-fixture";
import { draftFixture } from "./itinerary-draft-fixture";
import { AdjustmentFixture } from "./draft-adjustment-fixture";

afterEach(cleanup);
nativeDialogFixture();
const places = draftFixture.stops.map((stop) => stop.place);
const first = draftFixture.stops[0].place;
const extra = { id: "station", name: "另一个已有地点", viewpoints: [{ id: "new-view", frames: [] }] } as const;

describe("editing the complete itinerary in place", () => {
  it("keeps images, place order and the input in one document", () => {
    const onPlacesChange = vi.fn();
    render(<AdjustmentFixture onPlacesChange={onPlacesChange} />);
    const itinerary = within(screen.getByRole("region", { name: "东京半日巡礼" }));
    expect(within(itinerary.getByRole("list", { name: "建议游览顺序" })).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["須賀神社 男坂", "参宮橋 1号踏切"]);
    expect(itinerary.getByRole("textbox", { name: "调整想法" })).toBeTruthy();
    fireEvent.click(itinerary.getByRole("button", { name: "查看大图: 須賀神社 男坂" }));
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe("2 / 2");
    expect(onPlacesChange).not.toHaveBeenCalled();
  });

  it("submits only the remaining places without requiring an extra text instruction", () => {
    const onSubmit = vi.fn(), original = JSON.stringify(draftFixture);
    render(<AdjustmentFixture onSubmit={onSubmit} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "更新草案" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 参宮橋 1号踏切" }));
    expect(screen.queryByRole("heading", { name: "参宮橋 1号踏切" })).toBeNull();
    expect(screen.queryByText(/建议停留约/u)).toBeNull();
    expect(screen.getByText("地点已修改，更新后会重新安排顺序和停留建议。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新草案" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ draftId: "draft-a", instruction: "", places: [first] });
    expect(JSON.stringify(draftFixture)).toBe(original);
  });

  it("undo restores the removed stop and original suggestion without losing typed text", () => {
    render(<AdjustmentFixture value="下午出发" />);
    fireEvent.click(screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" }));
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 参宮橋 1号踏切" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("heading", { name: "参宮橋 1号踏切" })).toBeTruthy();
    expect(screen.getByText("建议停留约 20–40 分钟")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("下午出发");
  });
});

describe("editing viewpoint choices and adding places", () => {
  it("keeps removed viewpoints available to select again in the same place", () => {
    const onPlacesChange = vi.fn();
    render(<AdjustmentFixture onPlacesChange={onPlacesChange} />);
    fireEvent.click(screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择这个圣地: 須賀神社 男坂" }));
    expect(screen.getByText("取景位置 · 1/2")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择这个圣地: 須賀神社 男坂" }));
    expect(onPlacesChange).toHaveBeenLastCalledWith(places);
    expect(screen.queryByText("地点已修改，更新后会重新安排顺序和停留建议。")).toBeNull();
  });

  it("adds a supplied candidate through the gallery, preserving current places and input", () => {
    const onSubmit = vi.fn();
    render(<AdjustmentFixture candidates={[extra]} onSubmit={onSubmit} value="下午出发" />);
    fireEvent.click(screen.getByRole("button", { name: "添加地点" }));
    const picker = within(screen.getByRole("region", { name: "挑选地点" }));
    fireEvent.click(within(picker.getByRole("article", { name: extra.name })).getByRole("checkbox"));
    fireEvent.click(picker.getByRole("button", { name: "完成选点" }));
    expect(screen.getByRole("heading", { name: extra.name })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "挑选地点" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "添加地点" }));
    fireEvent.click(screen.getByRole("button", { name: "更新草案" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ draftId: "draft-a", instruction: "下午出发", places: [...places, extra] });
  });

  it("keeps an emptied draft editable while preventing an empty update", () => {
    const onSubmit = vi.fn();
    render(<AdjustmentFixture places={[]} onSubmit={onSubmit} value="下午出发" />);
    expect(screen.getByRole("button", { name: "添加地点" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "更新草案" }).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("locks place mutations during an update while pictures remain viewable", () => {
    const onPlacesChange = vi.fn();
    render(<AdjustmentFixture status="updating" onPlacesChange={onPlacesChange} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "添加地点" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 参宮橋 1号踏切" }));
    fireEvent.click(screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" }));
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").map((checkbox) => checkbox.disabled)).toEqual([true, true]);
    expect(onPlacesChange).not.toHaveBeenCalled();
  });
});

describe("selection data keeps its scope", () => {
  it("preserves unrelated places without viewpoints when one viewpoint is removed", () => {
    const noImages = { id: "no-images", name: "没有图片的地点", viewpoints: [] };
    const edit = removeDraftViewpoint([first, noImages], first, first.viewpoints[0]);
    expect(edit.places).toEqual([{ ...first, viewpoints: [first.viewpoints[1]] }, noImages]);
  });

  it("merges candidate viewpoints by place and does not duplicate a selected viewpoint", () => {
    const candidates = [{ ...first, viewpoints: [...first.viewpoints, extra.viewpoints[0]] }];
    expect(availableDraftPlaces(draftFixture, candidates, places)[0]?.viewpoints).toHaveLength(3);
    expect(addDraftViewpoint(places, first, first.viewpoints[0])).toBe(places);
    expect(draftWithSelection(draftFixture, places)).toBe(draftFixture);
  });
});
