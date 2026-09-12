/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneGroupCard } from "../../../src/features/chat/components/SceneGroupCard";
import { SceneGroupPreview } from "../../../src/features/chat/components/SceneGroupPreview";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { sceneFrameCount, sceneGroupCopy } from "../../../src/features/chat/scene-group-copy";
import { sceneGroupLabel } from "../../../src/features/chat/lib/scene-group";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const dict = chatDictFor("zh");
const props = { placeName: "宇治橋", dict, selected: false, onToggle: vi.fn() };

describe("scene groups with incomplete images", () => {
  it("keeps the place selectable when no frames have images", () => {
    const onToggle = vi.fn();
    render(<SceneGroupCard {...props} onToggle={onToggle} viewpoint={{ id: "empty", frames: [{ id: "no-url" }] }} />);
    expect(screen.getByText("暂无场景图片")).toBeTruthy();
    expect(screen.queryByText(dict.search.sceneUnavailable)).toBeNull();
    expect(screen.queryByRole("button", { name: "查看大图: 宇治橋" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("keeps selection available after a thumbnail fails and retries a new URL", () => {
    const view = render(<SceneGroupCard {...props} viewpoint={{ id: "bridge", frames: [{ id: "a", url: "/broken" }] }} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText(dict.search.sceneUnavailable)).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    view.rerender(<SceneGroupCard {...props} viewpoint={{ id: "bridge", frames: [{ id: "a", url: "/fixed" }] }} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/fixed");
  });

  it("counts only viewable frames and skips missing URLs when opening the preview", () => {
    render(<SceneGroupCard {...props} viewpoint={{ id: "bridge", frames: [{ id: "missing" }, { id: "a", url: "/a.webp" }] }} />);
    expect(screen.queryByText("2 张")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治橋" }));
    expect(within(screen.getByRole("dialog")).getByRole("img").getAttribute("src")).toBe("/a.webp");
  });

  it("can continue to another frame after a full-size image fails", () => {
    render(<SceneGroupCard {...props} viewpoint={{ id: "bridge", frames: [{ id: "a", url: "/a.webp" }, { id: "b", url: "/b.webp" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治橋" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.error(dialog.getByRole("img"));
    expect(dialog.getByText(dict.search.sceneUnavailable)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "下一张" }));
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/b.webp");
  });

  it("renders no orphan modal when a preview receives no images", () => {
    render(<SceneGroupPreview placeName="宇治橋" dict={dict} viewpoint={{ id: "empty", frames: [] }} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("provides Chinese, Japanese and English frame controls", () => {
    expect(sceneFrameCount("zh", 12)).toBe("12 张");
    expect(sceneFrameCount("ja", 12)).toBe("12枚");
    expect(sceneFrameCount("en", 12)).toBe("12 photos");
    expect(sceneGroupCopy("en").next).toBe("Next photo");
    expect(sceneGroupCopy("ja").previous).toBe("前の写真");
    expect(sceneGroupLabel("宇治橋", { id: "blank", name: "  ", frames: [] })).toBe("宇治橋");
  });
});
