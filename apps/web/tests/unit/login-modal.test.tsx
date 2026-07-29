/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginModal } from "../../src/components/auth/LoginModal";
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
