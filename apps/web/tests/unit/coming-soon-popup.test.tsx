/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComingSoonPopup } from "../../src/components/landing/ComingSoonPopup";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("ComingSoonPopup", () => {
  it("renders nothing while closed", () => {
    renderWithLocale(<ComingSoonPopup open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the aria-modal dialog with the ja copy when open", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("ただいま準備中です");
    expect(screen.getByText("ただいま準備中です")).toBeTruthy();
    expect(screen.getByText(/この機能はただいま準備中です/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "了解しました" })).toBeTruthy();
  });

  it("closes on the action button, the backdrop, and Escape", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "了解しました" }));
    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("ComingSoonPopup backdrop is missing");
    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps open when clicking inside the dialog body", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keys", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ComingSoonPopup focus management", () => {
  it("moves focus to the first focusable when it opens", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "とじる" }));
  });

  it("wraps Tab focus around the dialog edges", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "とじる" });
    const action = screen.getByRole("button", { name: "了解しました" });
    action.focus();
    fireEvent.keyDown(action, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(action);
  });
});
