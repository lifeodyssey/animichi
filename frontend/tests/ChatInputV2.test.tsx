/**
 * Tests for components/chat/ChatInputV2.tsx
 *
 * Covers: render, typing, Enter submit, button click submit, disabled state,
 * placeholder override, send button visibility, clear after send.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInputV2 from "@/components/chat/ChatInputV2";

describe("ChatInputV2", () => {
  it("renders with default placeholder", () => {
    render(<ChatInputV2 onSend={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("アニメ名や行きたい場所を入力…"),
    ).toBeTruthy();
  });

  it("renders with a custom placeholder when placeholderOverride is set", () => {
    render(<ChatInputV2 onSend={vi.fn()} placeholderOverride="Search here" />);
    expect(screen.getByPlaceholderText("Search here")).toBeTruthy();
  });

  it("calls onSend with the typed text when Enter is pressed", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInputV2 onSend={onSend} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "宇治の聖地");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("宇治の聖地");
  });

  it("clears the input after sending", async () => {
    const user = userEvent.setup();
    render(<ChatInputV2 onSend={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "test");
    await user.keyboard("{Enter}");
    expect(input.value).toBe("");
  });

  it("calls onSend when the send button is clicked", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInputV2 onSend={onSend} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "テスト");
    await user.click(screen.getByRole("button", { name: "送信" }));
    expect(onSend).toHaveBeenCalledWith("テスト");
  });

  it("does not call onSend when input is empty and Enter is pressed", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInputV2 onSend={onSend} />);
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when input is whitespace only", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInputV2 onSend={onSend} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "   ");
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the input when disabled prop is true", () => {
    render(<ChatInputV2 onSend={vi.fn()} disabled />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("does not call onSend when disabled even with text", async () => {
    const onSend = vi.fn();
    render(<ChatInputV2 onSend={onSend} disabled />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
