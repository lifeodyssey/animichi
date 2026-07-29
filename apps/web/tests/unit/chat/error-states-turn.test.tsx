/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
import { StreamInterruption } from "../../../src/features/chat/components/ErrorStates/StreamInterruption";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja"]); });
afterEach(cleanup);

const ja = chatDictFor("ja");

describe("StreamInterruption (D4 mid-stream drop)", () => {
  it("announces the interruption and retries on the inline button", () => {
    const onRetry = vi.fn();
    renderWithLocale(<StreamInterruption state="D4" dict={ja} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d4Message);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d4Retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("locks the retry button while a recovery is in flight", () => {
    renderWithLocale(<StreamInterruption state="D4" dict={ja} onRetry={vi.fn()} recovering />);
    expect(screen.getByRole("button", { name: ja.errorStates.d4Retry }).hasAttribute("disabled")).toBe(true);
  });
});

describe("StreamInterruption (D5 timeout)", () => {
  it("keeps the same retry shape with the timeout copy", () => {
    const onRetry = vi.fn();
    renderWithLocale(<StreamInterruption state="D5" dict={ja} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d5Message);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d5Retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("SessionExpired (D8)", () => {
  it("announces the expiry without discarding the surrounding conversation", () => {
    renderWithLocale(<SessionExpired dict={ja} onResume={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d8Message);
  });

  it("opens the login dialog inline so the chat never unmounts", () => {
    renderWithLocale(<SessionExpired dict={ja} onResume={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d8Login }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resumes the conversation from the inline banner", () => {
    const onResume = vi.fn();
    renderWithLocale(<SessionExpired dict={ja} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d8Resume }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("locks the resume button while recovery is in flight", () => {
    renderWithLocale(<SessionExpired dict={ja} onResume={vi.fn()} recovering />);
    expect(screen.getByRole("button", { name: ja.errorStates.d8Resume }).hasAttribute("disabled")).toBe(true);
  });
});

describe("BudgetExhausted (D11 anonymous daily budget)", () => {
  it.each(LOCALES)("renders the %s budget copy, not the session-expiry copy", (locale) => {
    const dict = chatDictFor(locale);
    renderWithLocale(<BudgetExhausted dict={dict} />);
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain(dict.errorStates.d11Message);
    expect(alert).not.toContain(dict.errorStates.d8Message);
  });

  it("opens the login dialog inline, the same affordance D8 offers", () => {
    renderWithLocale(<BudgetExhausted dict={ja} />);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d11Login }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no resume button — an anonymous visitor has no session to resume", () => {
    renderWithLocale(<BudgetExhausted dict={ja} />);
    expect(screen.queryByRole("button", { name: ja.errorStates.d8Resume })).toBeNull();
  });
});
