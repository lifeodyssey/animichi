/**
 * @vitest-environment jsdom
 *
 * D10: the edge rate limiter asked us to slow down (issue #274 / S1.8). A 429
 * must reach the user as in-character copy with a way forward, never as a bare
 * status code.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamInterruption } from "../../../src/features/chat/components/ErrorStates/StreamInterruption";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { classifyFailure } from "../../../src/lib/chat/errorClassifier";
import { LOCALES } from "../../../src/i18n/locales";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja"]); });
afterEach(cleanup);

const ja = chatDictFor("ja");

function view(overrides: { recovering?: boolean } = {}) {
  return {
    state: "D10" as const,
    onRetry: vi.fn(),
    onExpiredResume: vi.fn(),
    recovering: overrides.recovering ?? false,
  };
}

describe("classifying the edge rate limit", () => {
  it("maps a 429 onto D10 rather than the generic interruption", () => {
    expect(classifyFailure({ kind: "http", status: 429 })).toBe("D10");
  });

  it("still maps the budget-breaker 403 onto the login-recovery state", () => {
    expect(classifyFailure({ kind: "http", status: 403 })).toBe("D8");
  });

  it("leaves other 4xx statuses on the generic interruption", () => {
    expect(classifyFailure({ kind: "http", status: 400 })).toBe("D4");
  });
});

describe("D10 rate-limited copy", () => {
  it("shows the friendly wait message instead of a bare 429", () => {
    renderWithLocale(<StreamInterruption state="D10" dict={ja} onRetry={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(ja.errorStates.d10Message);
    expect(alert.textContent).not.toContain("429");
  });

  it("offers a retry that resends the turn", () => {
    const onRetry = vi.fn();
    renderWithLocale(<StreamInterruption state="D10" dict={ja} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d10Retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("locks the retry while a recovery is in flight", () => {
    renderWithLocale(<StreamInterruption state="D10" dict={ja} onRetry={vi.fn()} recovering />);
    expect(screen.getByRole("button", { name: ja.errorStates.d10Retry }).hasAttribute("disabled")).toBe(true);
  });

  it("routes the D10 turn failure to the retry strip, not the login banner", () => {
    renderWithLocale(<TurnFailure view={view()} dict={ja} />);
    expect(screen.getByRole("alert").getAttribute("data-state")).toBe("D10");
    expect(screen.queryByRole("button", { name: ja.errorStates.d8Login })).toBeNull();
  });

  it.each(LOCALES)("carries non-empty wait copy in %s", (locale) => {
    const states = chatDictFor(locale).errorStates;
    expect(states.d10Message.length).toBeGreaterThan(0);
    expect(states.d10Retry.length).toBeGreaterThan(0);
  });
});
