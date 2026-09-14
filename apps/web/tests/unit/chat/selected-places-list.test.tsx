/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewFixture, reviewPlaces } from "./selected-places-fixture";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();

describe("selection review browsing", () => {
  it("counts places once and only expands places with multiple selected viewpoints", () => {
    render(<ReviewFixture />);
    expect(screen.getByText("2 个地点")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "展开取景位置: 宇治神社" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开取景位置: 宇治橋" }));
    expect(within(screen.getByRole("list", { name: "宇治橋" })).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "收起取景位置: 宇治橋" }));
    expect(screen.queryByRole("list", { name: "宇治橋" })).toBeNull();
  });

  it("previews and flips selected frames without changing the selection", () => {
    const onChange = vi.fn();
    render(<ReviewFixture onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "查看大图: 宇治橋 · 橋上" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(within(screen.getByRole("dialog")).getByRole("img").getAttribute("src")).toBe("/b.webp");
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns to browsing without altering the selection", () => {
    const onBack = vi.fn(), onChange = vi.fn();
    render(<ReviewFixture onBack={onBack} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "返回浏览" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("selection review removal", () => {
  it("removes one viewpoint, preserves its place, and restores the original frame membership on undo", () => {
    const onChange = vi.fn();
    render(<ReviewFixture onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "展开取景位置: 宇治橋" }));
    fireEvent.click(screen.getByRole("button", { name: "移除取景位置: 橋上" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...reviewPlaces[0], viewpoints: [reviewPlaces[0].viewpoints[1]] }, reviewPlaces[1]]);
    expect(screen.getByText("2 个地点")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /展开取景位置/ })).toBeNull();
    expect(screen.getByText("橋下")).toBeTruthy();
    expect(screen.getByText("已移除取景位置：橋上")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "宇治橋" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange).toHaveBeenLastCalledWith(reviewPlaces);
  });

  it("removes a whole place, moves focus to the next place, and restores order on undo", () => {
    const onChange = vi.fn();
    render(<ReviewFixture onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 宇治橋" }));
    expect(onChange).toHaveBeenLastCalledWith([reviewPlaces[1]]);
    expect(screen.getByText("已移除 宇治橋")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "宇治神社" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange).toHaveBeenLastCalledWith(reviewPlaces);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "宇治橋" }));
  });

  it("retains an undo path after removing the final place", () => {
    render(<ReviewFixture places={[reviewPlaces[1]]} />);
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 宇治神社" }));
    expect(screen.getByText("还没有选中的地点")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "所选地点" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("heading", { name: "宇治神社" })).toBeTruthy();
  });
});
