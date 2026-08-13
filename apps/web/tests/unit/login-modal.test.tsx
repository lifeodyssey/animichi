/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginModal } from "../../src/features/auth/ui/LoginModal";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("LoginModal", () => {
  it("renders nothing while closed", () => {
    renderWithLocale(<LoginModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the dialog with subtitle and form when open", () => {
    renderWithLocale(<LoginModal open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
  });

  it("closes on the close button, the mask, and Escape", () => {
    const onClose = vi.fn();
    renderWithLocale(<LoginModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps open when clicking inside the dialog body", () => {
    const onClose = vi.fn();
    renderWithLocale(<LoginModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keys", () => {
    const onClose = vi.fn();
    renderWithLocale(<LoginModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("LoginModal focus trap", () => {
  it("wraps Tab from the last focusable back to the first", () => {
    renderWithLocale(<LoginModal open onClose={vi.fn()} />);
    const last = screen.getByRole("button", { name: "ログインリンクを送信" });
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }));
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    renderWithLocale(<LoginModal open onClose={vi.fn()} />);
    const first = screen.getByRole("button", { name: "閉じる" });
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ログインリンクを送信" }));
  });

  it("leaves focus on a middle focusable when Tab is pressed inside the dialog", () => {
    renderWithLocale(<LoginModal open onClose={vi.fn()} />);
    const email = screen.getByLabelText("メールアドレス");
    email.focus();
    expect(document.activeElement).toBe(email);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(email);
  });
});
