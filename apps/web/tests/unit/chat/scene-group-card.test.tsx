/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneGroupCard } from "../../../src/features/chat/components/SceneGroupCard";
import type { SceneGroupCardProps } from "../../../src/features/chat/components/SceneGroupCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const dict = chatDictFor("zh");
const viewpoint = { id: "bridge", frames: [{ id: "a", url: "/a.webp" }, { id: "b", url: "/b.webp" }] };

function Card({ onToggle = vi.fn(), ...props }: Partial<SceneGroupCardProps>) {
  const [selected, setSelected] = useState(false);
  return <SceneGroupCard dict={dict} placeName="宇治橋" viewpoint={viewpoint} selected={selected} onToggle={() => { setSelected((value) => !value); onToggle(); }} {...props} />;
}

describe("one choice per scene group", () => {
  it("selects the whole card with its corner button, without opening a preview", () => {
    const onToggle = vi.fn();
    render(<Card onToggle={onToggle} />);
    const pick = screen.getByRole("checkbox", { name: "选择这个圣地: 宇治橋" });
    fireEvent.click(pick);
    expect(screen.getByRole("article").getAttribute("data-selected")).toBe("true");
    expect(pick.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onToggle).toHaveBeenCalledOnce();
    fireEvent.click(pick);
    expect(screen.getByRole("article").getAttribute("data-selected")).toBe("false");
  });

  it("previews and flips frames without changing the existing selection", () => {
    render(<Card />);
    fireEvent.click(screen.getByRole("checkbox"));
    const preview = screen.getByRole("button", { name: "查看大图: 宇治橋" });
    preview.focus();
    fireEvent.click(preview);
    const dialog = within(screen.getByRole("dialog", { name: "宇治橋" }));
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/a.webp");
    expect(dialog.getByRole<HTMLButtonElement>("button", { name: "上一张" }).disabled).toBe(true);
    fireEvent.click(dialog.getByRole("button", { name: "下一张" }));
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/b.webp");
    expect(dialog.getByRole("status").textContent).toBe("2 / 2");
    expect(dialog.getByRole<HTMLButtonElement>("button", { name: "下一张" }).disabled).toBe(true);
    fireEvent.click(dialog.getByRole("button", { name: "上一张" }));
    fireEvent.click(dialog.getByRole("button", { name: "关闭预览" }));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(preview);
  });

});

describe("scene group information and volume", () => {
  it("never invents a viewpoint name when only a place name is supplied", () => {
    render(<Card />);
    expect(screen.getByRole("article", { name: "宇治橋" })).toBeTruthy();
    expect(screen.getByText("宇治橋")).toBeTruthy();
    expect(screen.getByText("2 张")).toBeTruthy();
  });

  it("uses a supplied viewpoint label and keeps the place in accessible names", () => {
    render(<Card viewpoint={{ ...viewpoint, name: "橋上" }} />);
    expect(screen.getByText("橋上")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "选择这个圣地: 宇治橋 · 橋上" })).toBeTruthy();
  });

  it("keeps a single frame free of unnecessary count and navigation controls", () => {
    render(<Card viewpoint={{ ...viewpoint, name: "宇治橋", frames: viewpoint.frames.slice(0, 1) }} />);
    expect(screen.queryByText("1 张")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治橋" }));
    expect(screen.queryByRole("button", { name: "下一张" })).toBeNull();
  });

  it("does not mount hundreds of images for one viewpoint", () => {
    const frames = Array.from({ length: 520 }, (_, index) => ({ id: String(index), url: `/${String(index)}.webp` }));
    render(<Card viewpoint={{ ...viewpoint, frames }} />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("520 张")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治橋" }));
    expect(within(screen.getByRole("dialog")).getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { hidden: true }).getAttribute("aria-checked")).toBe("false");
  });
});
