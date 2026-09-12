/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../../src/features/chat/components/ChatInput";
import { QuotaExhausted, QUOTA_BANNER_ID } from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LOCALES } from "../../../src/i18n/locales";
import { sendMagicLink } from "../../../src/lib/auth/neon-auth";
import { setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neon-auth", () => ({ sendMagicLink: vi.fn() }));
const dict = chatDictFor("zh"), copy = dict.errorStates, auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); sessionStorage.clear(); vi.mocked(sendMagicLink).mockReset(); });
afterEach(() => { cleanup(); sessionStorage.clear(); });

function draftContext(onSend: (text: string) => void) {
  return <><p>四谷的地点仍在这里。</p><QuotaExhausted dict={dict} locale="zh" resetsAtMs={undefined} /><ChatInput dict={dict} disabled={false} quotaLocked onSend={onSend} /></>;
}

describe("quota guidance keeps the composer usable", () => {
  it("preserves editable draft text, withholds sending, and restores focus after login is dismissed", () => {
    const onSend = vi.fn();
    render(draftContext(onSend), { wrapper: LocaleProvider });
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: dict.inputPlaceholder });
    fireEvent.change(input, { target: { value: "我还想去代代木。" } });
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe(QUOTA_BANNER_ID);
    const login = screen.getByRole("button", { name: copy.d12Login });
    login.focus();
    fireEvent.click(login);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(login);
    expect(screen.getByRole("textbox", { name: dict.inputPlaceholder })).toBe(input);
    expect(input.value).toBe("我还想去代代木。");
    expect(screen.getByText("四谷的地点仍在这里。")).toBeTruthy();
    fireEvent.change(input, { target: { value: "我还想去代代木和涩谷。" } });
    fireEvent.submit(input);
    expect(input.value).toBe("我还想去代代木和涩谷。");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: dict.send }).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("quota and login delivery remain separate", () => {
  it("keeps the caller's quota lock and draft after an acknowledged email delivery", async () => {
    const onSend = vi.fn();
    vi.mocked(sendMagicLink).mockResolvedValue("sent");
    render(draftContext(onSend), { wrapper: LocaleProvider });
    fireEvent.change(screen.getByRole("textbox", { name: dict.inputPlaceholder }), { target: { value: "看看代代木。" } });
    fireEvent.click(screen.getByRole("button", { name: copy.d12Login }));
    fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: "fan@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("heading", { name: auth.sent_title });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("status").textContent).toContain(copy.d12Title);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: dict.inputPlaceholder }).value).toBe("看看代代木。");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: dict.send }).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("localized quota notice semantics", () => {
  it.each(LOCALES)("associates the login action with the limit and recovery guidance in %s", (locale) => {
    const localized = chatDictFor(locale);
    render(<QuotaExhausted dict={localized} locale={locale} resetsAtMs={undefined} />, { wrapper: LocaleProvider });
    const login = screen.getByRole("button", { name: localized.errorStates.d12Login });
    const description = document.getElementById(login.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain(localized.errorStates.d12Title);
    expect(description?.textContent).toContain(localized.errorStates.d12Message);
    expect(login.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
