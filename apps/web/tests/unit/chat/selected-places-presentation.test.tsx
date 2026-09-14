/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { nativeDialogFixture } from "./dialog-fixture";
import { ReviewFixture, reviewPlaces } from "./selected-places-fixture";

afterEach(cleanup);
nativeDialogFixture();

describe("review image and empty states", () => {
  it("keeps a place without images removable", () => {
    render(<ReviewFixture places={[{ ...reviewPlaces[1], viewpoints: [{ id: "empty", frames: [] }] }]} />);
    expect(screen.getByRole("img", { name: "暂无场景图片" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 宇治神社" }));
    expect(screen.getByText("还没有选中的地点")).toBeTruthy();
  });

  it("falls back when an image fails, without hiding the place", () => {
    render(<ReviewFixture places={[reviewPlaces[1]]} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img", { name: "暂无场景图片" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "宇治神社" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /查看大图/ })).toBeNull();
  });

  it("offers a way back to browsing from an empty selection", () => {
    const onBack = vi.fn();
    render(<ReviewFixture places={[]} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "继续浏览" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts a 520-frame viewpoint as one place and mounts one image at a time", () => {
    const frames = Array.from({ length: 520 }, (_, index) => ({ id: String(index), url: "/frame.webp" }));
    render(<ReviewFixture places={[{ ...reviewPlaces[1], viewpoints: [{ id: "many", frames }] }]} />);
    expect(screen.getByText("1 个地点")).toBeTruthy();
    expect(screen.getByText("520 张图片")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治神社" }));
    expect(within(screen.getByRole("dialog")).getAllByRole("img")).toHaveLength(1);
  });
});

describe("review languages", () => {
  it("uses singular place and viewpoint counts in English", () => {
    render(<ReviewFixture places={[reviewPlaces[0]]} dict={chatDictFor("en")} />);
    expect(screen.getByText("1 place")).toBeTruthy();
    expect(screen.getByText("2 viewpoints")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to browsing" })).toBeTruthy();
  });

  it("localizes Japanese counts and removal actions", () => {
    render(<ReviewFixture dict={chatDictFor("ja")} />);
    expect(screen.getByText("2か所")).toBeTruthy();
    expect(screen.getByRole("button", { name: "場所を外す: 宇治神社" })).toBeTruthy();
  });
});
