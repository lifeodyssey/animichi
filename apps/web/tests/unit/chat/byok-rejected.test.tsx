/** @vitest-environment jsdom */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatReturnTargetProvider } from "../../../src/features/chat/ChatReturnTarget";
import { ByokRejected } from "../../../src/features/chat/components/ErrorStates/ByokRejected";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";
import { renderWithLocale, setLanguages } from "../_i18n";

const dict = chatDictFor("zh");
beforeEach(() => { setLanguages(["zh"]); });
afterEach(cleanup);

describe("rejected keys explain the recovery action", () => {
  it.each(LOCALES)("announces the failure and describes the settings link in %s", (locale) => {
    const localized = chatDictFor(locale), copy = localized.byok;
    renderWithLocale(<ByokRejected dict={localized} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(copy.notAcceptedTitle)).toBeTruthy();
    expect(within(alert).getByText(copy.notAccepted)).toBeTruthy();
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    const link = screen.getByRole("link", { name: copy.openSettings });
    expect(link.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.contains(link)).toBe(false);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps descriptions separate when two failures are visible", () => {
    renderWithLocale(<><ByokRejected dict={dict} /><ByokRejected dict={dict} /></>);
    const alerts = screen.getAllByRole("alert"), links = screen.getAllByRole("link");
    expect(alerts[0]?.id).not.toBe(alerts[1]?.id);
    expect(links[0]?.getAttribute("aria-describedby")).toBe(alerts[0]?.id);
    expect(links[1]?.getAttribute("aria-describedby")).toBe(alerts[1]?.id);
  });

  it("presents D14 without replaying the turn or starting session recovery", () => {
    const view = { state: "D14", onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false } as const;
    renderWithLocale(<TurnFailure view={view} dict={dict} locale="zh" />);
    screen.getByRole("link", { name: dict.byok.openSettings }).focus();
    expect(view.onRetry).not.toHaveBeenCalled();
    expect(view.onExpiredResume).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the settings link carries the current conversation", () => {
  it.each(["chat-123", "会话 &next=/settings"])("preserves session %s without adding query parameters", (session) => {
    renderWithLocale(<ChatReturnTargetProvider sessionIdOf={() => session}><ByokRejected dict={dict} /></ChatReturnTargetProvider>);
    const url = new URL(screen.getByRole("link").getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/settings");
    expect(url.hash).toBe("#api-key");
    expect([...url.searchParams.entries()]).toEqual([["session", session]]);
  });

  it("does not invent a conversation when none is available", () => {
    renderWithLocale(<ChatReturnTargetProvider sessionIdOf={() => undefined}><ByokRejected dict={dict} /></ChatReturnTargetProvider>);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings#api-key");
  });
});
