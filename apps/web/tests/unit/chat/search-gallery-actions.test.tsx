/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { SpotCardGrid } from "../../../src/features/chat/components/SearchSpotCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { SpotSelectionProvider, useSpotSelectionState } from "../../../src/features/chat/selection/use-spot-selection";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const dict = chatDictFor("zh");
const spots = [{ id: "bridge", name: "宇治桥", city: "宇治市", screenshotUrl: "/bridge.webp" }, { id: "shrine", name: "宇治神社", city: "宇治市" }];

function Gallery({ send = vi.fn(), disabled = false }: Readonly<{ send?: (text: string) => void; disabled?: boolean }>) {
  const selection = useSpotSelectionState();
  return <ChatActionsProvider actions={{ send, regenerate: vi.fn(), disabled }}><SpotSelectionProvider selection={selection}><SpotCardGrid spots={spots} dict={dict} /></SpotSelectionProvider></ChatActionsProvider>;
}

describe("direct scene gallery actions", () => {
  it("selects and deselects a place directly without opening its image", () => {
    render(<Gallery />);
    expect(screen.queryByRole("button", { name: "自己挑地点" })).toBeNull();
    const pick = screen.getByRole("checkbox", { name: "选择这个圣地: 宇治桥" });
    fireEvent.click(pick);
    expect(pick.getAttribute("aria-checked")).toBe("true");
    expect(pick.closest("li")?.getAttribute("data-selected")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(pick);
    expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(2);
    expect(pick.closest("li")?.getAttribute("data-selected")).toBe("false");
  });

  it("opens the image independently and keeps picks after the preview closes", () => {
    render(<Gallery />);
    const pick = screen.getByRole("checkbox", { name: "选择这个圣地: 宇治桥" });
    fireEvent.click(screen.getByRole("img", { name: "宇治桥" }));
    expect(screen.getByRole("dialog", { name: "宇治桥" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(2);
    fireEvent.click(pick);
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 宇治桥" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(1);
  });

  it("asks the assistant to arrange this group without selecting every place", () => {
    const send = vi.fn();
    render(<Gallery send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "帮我安排" }));
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("宇治桥"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("宇治神社"));
    expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(2);
  });

  it("disables automatic planning while chat cannot accept a turn", () => {
    const send = vi.fn();
    render(<Gallery send={send} disabled />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "帮我安排" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "帮我安排" }));
    expect(send).not.toHaveBeenCalled();
  });
});
