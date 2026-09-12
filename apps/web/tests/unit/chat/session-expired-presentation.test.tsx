/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
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

describe("in-place sign-in recovery", () => {
  it("preserves surrounding messages and draft input and returns focus after dismissing login", () => {
    const onResume = vi.fn();
    render(<><p>四谷的几个取景地可以放在一起看。</p><input aria-label="草稿" defaultValue="想去新宿" /><SessionExpired dict={dict} onResume={onResume} /></>, { wrapper: LocaleProvider });
    const message = screen.getByText("四谷的几个取景地可以放在一起看。"), draft = screen.getByRole<HTMLInputElement>("textbox", { name: "草稿" });
    const login = screen.getByRole("button", { name: copy.d8Login });
    expect(screen.queryByRole("dialog")).toBeNull();
    login.focus();
    fireEvent.click(login);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("四谷的几个取景地可以放在一起看。")).toBe(message);
    expect(draft.value).toBe("想去新宿");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(login);
    expect(screen.getByRole("alert").textContent).toContain(copy.d8Message);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("caller-owned history recovery", () => {
  it("announces only caller-confirmed loading, blocks both actions, and keeps resume focus", () => {
    const onResume = vi.fn(), props = { dict, onResume };
    const view = render(<SessionExpired {...props} />, { wrapper: LocaleProvider });
    const resume = screen.getByRole("button", { name: copy.d8Resume });
    const login = screen.getByRole("button", { name: copy.d8Login });
    resume.focus();
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<SessionExpired {...props} recovering />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(copy.d8Recovering);
    expect(screen.getByRole("button", { name: copy.d8Resume })).toBe(resume);
    expect(document.activeElement).toBe(resume);
    expect(resume.getAttribute("aria-disabled")).toBe("true");
    expect(resume.getAttribute("aria-busy")).toBe("true");
    expect(login.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(resume);
    fireEvent.click(login);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<SessionExpired {...props} />);
    expect(screen.getByRole("alert").textContent).toContain(copy.d8Message);
    expect(resume.getAttribute("aria-disabled")).toBe("false");
    expect(login.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(2);
  });
});

describe("email delivery and authentication", () => {
  it("does not treat a confirmed email delivery or dialog dismissal as authentication", async () => {
    const onResume = vi.fn();
    vi.mocked(sendMagicLink).mockResolvedValue("sent");
    render(<SessionExpired dict={dict} onResume={onResume} />, { wrapper: LocaleProvider });
    fireEvent.click(screen.getByRole("button", { name: copy.d8Login }));
    fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: "fan@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("heading", { name: auth.sent_title });
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.queryByText(copy.d8Recovering)).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alert").textContent).toContain(copy.d8Message);
    expect(screen.queryByRole("status")).toBeNull();
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("localized sign-in recovery guidance", () => {
  it.each(LOCALES)("describes the resume action with its prerequisite in %s", (locale) => {
    const localized = chatDictFor(locale);
    render(<SessionExpired dict={localized} onResume={vi.fn()} />, { wrapper: LocaleProvider });
    expect(screen.getByRole("alert").textContent).toContain(localized.errorStates.d8Hint);
    const resume = screen.getByRole("button", { name: localized.errorStates.d8Resume });
    const ids = (resume.getAttribute("aria-describedby") ?? "").split(" ");
    expect(document.getElementById(ids[0] ?? "")?.textContent).toBe(localized.errorStates.d8ResumeHint);
    expect(document.getElementById(ids[1] ?? "")?.textContent).toContain(localized.errorStates.d8Message);
    expect(screen.getByRole("button", { name: localized.errorStates.d8Login }).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it.each(LOCALES)("keeps localized content guidance available while reading history in %s", (locale) => {
    const localized = chatDictFor(locale);
    render(<SessionExpired dict={localized} onResume={vi.fn()} recovering />, { wrapper: LocaleProvider });
    expect(screen.getByRole("status").textContent).toContain(localized.errorStates.d8Recovering);
    expect(screen.getByRole("status").textContent).toContain(localized.errorStates.d8RecoveringHint);
  });
});
