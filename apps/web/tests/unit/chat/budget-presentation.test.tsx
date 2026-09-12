/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LOCALES } from "../../../src/i18n/locales";
import { sendMagicLink } from "../../../src/lib/auth/neon-auth";
import { setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neon-auth", () => ({ sendMagicLink: vi.fn() }));
const dict = chatDictFor("zh"), copy = dict.errorStates, auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); vi.mocked(sendMagicLink).mockReset(); });
afterEach(cleanup);

describe("localized shared-budget guidance", () => {
  it.each(LOCALES)("describes the sign-in action with the budget status in %s", (locale) => {
    const localized = chatDictFor(locale);
    render(<BudgetExhausted dict={localized} />, { wrapper: LocaleProvider });
    const login = screen.getByRole("button", { name: localized.errorStates.d11Login });
    const description = document.getElementById(login.getAttribute("aria-describedby") ?? "");
    expect(description).toBe(screen.getByRole("status"));
    expect(description?.textContent).toContain(localized.errorStates.d11Title);
    expect(description?.textContent).toContain(localized.errorStates.d11Message);
    expect(description?.getAttribute("aria-atomic")).toBe("true");
    expect(login.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the BYOK explanation is an optional disclosure", () => {
  it("toggles its associated content without opening login or sending mail", () => {
    render(<BudgetExhausted dict={dict} />, { wrapper: LocaleProvider });
    const toggle = screen.getByRole("button", { name: dict.byok.d11UseOwnKey });
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(screen.getByRole("region", { name: dict.byok.upsellTitle }).parentElement).toBe(panel);
    expect(screen.getByText(dict.byok.upsellPrivacy)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    expect(screen.queryByRole("region", { name: dict.byok.upsellTitle })).toBeNull();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(screen.getAllByRole("region", { name: dict.byok.upsellTitle })).toHaveLength(1);
    expect(sendMagicLink).not.toHaveBeenCalled();
  });
});

describe("ordinary sign-in preserves the surrounding work", () => {
  it("returns focus to the action without replacing prior content or unsent text", () => {
    render(<><p>四谷的地点仍在这里。</p><BudgetExhausted dict={dict} /><textarea aria-label="Draft" defaultValue="想去代代木。" /></>, { wrapper: LocaleProvider });
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft" });
    const login = screen.getByRole("button", { name: copy.d11Login });
    login.focus();
    fireEvent.click(login);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(login);
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
    expect(draft.value).toBe("想去代代木。");
    expect(screen.getByText("四谷的地点仍在这里。")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(copy.d11Title);
    expect(sendMagicLink).not.toHaveBeenCalled();
  });
});

describe("BYOK setup keeps its separate return target", () => {
  it("retains the explanation and budget status after acknowledged email delivery", async () => {
    vi.mocked(sendMagicLink).mockResolvedValue("sent");
    render(<BudgetExhausted dict={dict} />, { wrapper: LocaleProvider });
    const toggle = screen.getByRole("button", { name: dict.byok.d11UseOwnKey });
    fireEvent.click(toggle);
    const setup = screen.getByRole("button", { name: dict.byok.signInToSetUp });
    setup.focus();
    fireEvent.click(setup);
    fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: "fan@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("heading", { name: auth.sent_title });
    expect(sendMagicLink).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "http://localhost:3000/auth/callback?next=%2Fsettings%23api-key" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(setup);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: dict.byok.upsellTitle })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(copy.d11Title);
  });
});
