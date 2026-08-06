/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComingSoonPopup } from "../../src/components/landing/ComingSoonPopup";
import { LocaleProvider } from "../../src/i18n/context";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("ComingSoonPopup", () => {
  it("closes when Escape is pressed inside the dialog", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores non-Escape keys inside the dialog", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

});

describe("ComingSoonPopup keyboard traversal", () => {
  it("leaves Tab alone when focus is not at the trap edge", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "とじる" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("renders nothing while closed", () => {
    renderWithLocale(<ComingSoonPopup open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the aria-modal dialog with the ja copy when open", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("ただいま準備中です");
    expect(screen.getByText("ただいま準備中です")).not.toBeNull();
    expect(screen.getByText(/この機能はただいま準備中です/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "了解しました" })).not.toBeNull();
  });

  it("closes on the action button, the backdrop, and Escape", () => {
    const onClose = vi.fn();
    renderWithLocale(<ComingSoonPopup open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "了解しました" }));
    const backdrop = screen.getByRole("presentation");
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
  it("moves focus onto the dialog container when it opens", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("lets Tab pass through when the dialog has no focusable elements", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) button.remove();
    const propagated = fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(propagated).toBe(true);
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

  it("wraps Shift+Tab from the dialog container to the last focusable", () => {
    renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "了解しました" }));
  });

  it("restores focus to the previously focused element when it closes", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<LocaleProvider><ComingSoonPopup open={false} onClose={vi.fn()} /></LocaleProvider>);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes cleanly when no element was focused on open", () => {
    const spy = vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
    const { rerender } = renderWithLocale(<ComingSoonPopup open onClose={vi.fn()} />);
    rerender(<LocaleProvider><ComingSoonPopup open={false} onClose={vi.fn()} /></LocaleProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
    spy.mockRestore();
  });
});
