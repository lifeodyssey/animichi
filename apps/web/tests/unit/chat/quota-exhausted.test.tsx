/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import {
  QUOTA_BANNER_ID,
  QuotaExhausted,
  quotaNotice,
} from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja"]); });
afterEach(cleanup);

const ja = chatDictFor("ja");
const RESET_AT = Date.parse("2026-07-29T00:00:00Z");

function banner(resetsAtMs?: number) {
  return <QuotaExhausted dict={ja} locale="ja" resetsAtMs={resetsAtMs} />;
}

function turnView(state: "D11" | "D12") {
  return { state, onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false } as const;
}

describe("QuotaExhausted (D12 per-identity daily message quota)", () => {
  it.each(LOCALES)("renders the %s quota copy, not the shared-budget copy", (locale) => {
    const dict = chatDictFor(locale);
    renderWithLocale(<QuotaExhausted dict={dict} locale={locale} resetsAtMs={undefined} />);
    const notice = screen.getByRole("status").textContent;
    expect(notice).toContain(dict.errorStates.d12Message);
    expect(notice).not.toContain(dict.errorStates.d11Message);
  });

  it("announces as a status, not an alert — nothing failed here", () => {
    renderWithLocale(banner());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("opens the login dialog inline so the conversation never unmounts", () => {
    renderWithLocale(banner());
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d12Login }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no retry — retrying cannot mint more allowance", () => {
    renderWithLocale(banner());
    expect(screen.queryByRole("button", { name: ja.errorStates.d4Retry })).toBeNull();
    expect(screen.queryByRole("button", { name: ja.errorStates.d8Resume })).toBeNull();
  });

  it("carries the stable id the locked composer describes itself with", () => {
    renderWithLocale(banner());
    expect(screen.getByRole("status").getAttribute("id")).toBe(QUOTA_BANNER_ID);
  });
});

describe("quotaNotice names the reset instant in the reader's own timezone", () => {
  it.each(LOCALES)("renders the %s time-bearing copy when a reset instant is known", (locale) => {
    const dict = chatDictFor(locale);
    const expected = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(RESET_AT);
    const notice = quotaNotice(dict, locale, RESET_AT);
    expect(notice).toContain(expected);
    expect(notice).not.toContain("{time}");
  });

  it("falls back to the timeless copy rather than printing a placeholder", () => {
    expect(quotaNotice(ja, "ja", undefined)).toBe(ja.errorStates.d12Message);
  });

  it("shows the reset time in the banner the visitor actually reads", () => {
    const expected = new Intl.DateTimeFormat("ja", { hour: "numeric", minute: "2-digit" }).format(RESET_AT);
    renderWithLocale(banner(RESET_AT));
    expect(screen.getByRole("status").textContent).toContain(expected);
  });
});

describe("TurnFailure D12 routing", () => {
  it("routes a D12 turn to the quota banner", () => {
    renderWithLocale(<TurnFailure view={turnView("D12")} dict={ja} locale="ja" />);
    expect(screen.getByRole("status").textContent).toContain(ja.errorStates.d12Message);
  });

  it("keeps D11 on the shared-budget alert banner", () => {
    renderWithLocale(<TurnFailure view={turnView("D11")} dict={ja} locale="ja" />);
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain(ja.errorStates.d11Message);
    expect(alert).not.toContain(ja.errorStates.d12Message);
  });

  it("forwards the reset instant so the banner can name the time", () => {
    const view = { ...turnView("D12"), quotaResetsAtMs: RESET_AT };
    const expected = new Intl.DateTimeFormat("ja", { hour: "numeric", minute: "2-digit" }).format(RESET_AT);
    renderWithLocale(<TurnFailure view={view} dict={ja} locale="ja" />);
    expect(screen.getByRole("status").textContent).toContain(expected);
  });
});

describe("LimitBanner keeps each limit's own BEM block", () => {
  it.each([
    ["chat-quota-exhausted", banner(), "status", ja.errorStates.d12Login],
    ["chat-budget-exhausted", <BudgetExhausted dict={ja} />, "alert", ja.errorStates.d11Login],
  ])("emits the %s classes the stylesheet targets", (block, element, role, loginLabel) => {
    renderWithLocale(element);
    expect(screen.getByRole(role).className).toBe(block);
    expect(screen.getByRole("button", { name: loginLabel }).className).toContain(`${block}__login`);
  });
});
