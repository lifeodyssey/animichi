/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginModal } from "../../../src/features/auth/ui/LoginModal";
import { dictFor } from "../../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "../_i18n";

const auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

function Harness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => { setOpen(true); }}>保存草案</button><LoginModal open={open} onClose={() => { setOpen(false); }} /></>;
}

describe("login dialog dismissal and focus", () => {
  it("locks scrolling only while open and restores the invoking control on Escape", () => {
    document.body.style.overflow = "auto";
    renderWithLocale(<Harness />);
    const trigger = screen.getByRole("button", { name: "保存草案" });
    trigger.focus(); fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("textbox", { name: auth.email_label })).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the dialog on narrow or touch screens without opening the email keyboard", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    renderWithLocale(<LoginModal open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: auth.title });
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: auth.title }).id);
  });
});
