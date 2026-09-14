/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ByokRequiresLogin } from "../../../src/features/chat/components/ErrorStates/ByokRequiresLogin";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LOCALES } from "../../../src/i18n/locales";
import { sendMagicLink } from "../../../src/lib/auth/neon-auth";
import { setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neon-auth", () => ({ sendMagicLink: vi.fn() }));
const dict = chatDictFor("zh"), byok = dict.byok, auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); vi.mocked(sendMagicLink).mockReset(); });
afterEach(cleanup);

describe("the BYOK login requirement is one informed action", () => {
  it.each(LOCALES)("explains the requirement and billing before sign-in in %s", (locale) => {
    const localized = chatDictFor(locale), copy = localized.byok;
    render(<ByokRequiresLogin dict={localized} />, { wrapper: LocaleProvider });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(copy.errorRequiresLogin)).toBeTruthy();
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByText(copy.upsellPrivacy)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const button = screen.getByRole("button", { name: copy.signInToSetUp });
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent).join(" ");
    expect(described).toContain(copy.errorRequiresLogin);
    expect(described).toContain(copy.upsellCost);
    expect(described).toContain(copy.upsellAccount);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("keeps the account requirement references local to each prompt", () => {
    render(<><ByokRequiresLogin dict={dict} /><ByokRequiresLogin dict={dict} /></>, { wrapper: LocaleProvider });
    const [first, second] = screen.getAllByRole("alert"), [firstButton, secondButton] = screen.getAllByRole("button");
    expect(first?.id).not.toBe(second?.id);
    expect(firstButton?.getAttribute("aria-describedby")?.split(" ")[0]).toBe(first?.id);
    expect(secondButton?.getAttribute("aria-describedby")?.split(" ")[0]).toBe(second?.id);
  });
});

describe("login preserves the prompt and the setup destination", () => {
  it("returns focus without dismissing the requirement when login is cancelled", () => {
    render(<ByokRequiresLogin dict={dict} />, { wrapper: LocaleProvider });
    const alert = screen.getByRole("alert"), button = screen.getByRole("button", { name: byok.signInToSetUp });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("alert")).toBe(alert);
    expect(screen.getByText(byok.upsellPrivacy)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("keeps the requirement after email acknowledgement and carries the key-settings callback", async () => {
    vi.mocked(sendMagicLink).mockResolvedValue("sent");
    render(<ByokRequiresLogin dict={dict} />, { wrapper: LocaleProvider });
    const alert = screen.getByRole("alert"), button = screen.getByRole("button", { name: byok.signInToSetUp });
    button.focus();
    fireEvent.click(button);
    fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: "fan@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("heading", { name: auth.sent_title });
    expect(sendMagicLink).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "http://localhost:3000/auth/callback?next=%2Fsettings%23api-key" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alert")).toBe(alert);
    expect(document.activeElement).toBe(button);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
