/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamInterruption } from "../../../src/features/chat/components/ErrorStates/StreamInterruption";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import type { TurnFailureView } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import type { ChatErrorState } from "../../../src/features/chat/lib/error-classifier";
import { retryRecoversLatest } from "../../../src/features/chat/use-turn-failure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja"]); });
afterEach(cleanup);

const ja = chatDictFor("ja");

describe("StreamInterruption: the honest admission strips (W1 #1220)", () => {
  it.each([
    ["D15", ja.errorStates.d15Message, ja.errorStates.d15Retry],
    ["D16", ja.errorStates.d16Message, ja.errorStates.d16Retry],
    ["D17", ja.errorStates.d17Message, ja.errorStates.d17Retry],
  ] as const)("renders %s with its own copy and retry action", (state, message, retry) => {
    const onRetry = vi.fn();
    renderWithLocale(<StreamInterruption state={state} dict={ja} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain(message);
    fireEvent.click(screen.getByRole("button", { name: retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names the failing code in the honest-generic D18 copy", () => {
    renderWithLocale(<StreamInterruption state="D18" dict={ja} onRetry={vi.fn()} errorCode="502" />);
    const expected = ja.errorStates.d18Message.replace("{code}", "502");
    expect(screen.getByRole("alert").textContent).toContain(expected);
  });

  it("degrades the D18 code slot honestly when no code is known", () => {
    renderWithLocale(<StreamInterruption state="D18" dict={ja} onRetry={vi.fn()} />);
    const expected = ja.errorStates.d18Message.replace("{code}", "unknown");
    expect(screen.getByRole("alert").textContent).toContain(expected);
  });
});

function conflictView(state: ChatErrorState, errorCode?: string): TurnFailureView {
  return { state, errorCode, onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false };
}

describe("TurnFailure routes the conflict states onto the strip", () => {
  it.each([
    ["D15", ja.errorStates.d15Message],
    ["D16", ja.errorStates.d16Message],
    ["D17", ja.errorStates.d17Message],
  ] as const)("renders %s as its own strip, not a login banner", (state, message) => {
    renderWithLocale(<TurnFailure view={conflictView(state)} dict={ja} locale="ja" />);
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(screen.queryByText(ja.errorStates.d8Message)).toBeNull();
  });

  it("threads the failing code through to the D18 strip", () => {
    renderWithLocale(<TurnFailure view={conflictView("D18", "teapot")} dict={ja} locale="ja" />);
    const expected = ja.errorStates.d18Message.replace("{code}", "teapot");
    expect(screen.getByRole("alert").textContent).toContain(expected);
  });
});

describe("retryRecoversLatest: which retries re-read state instead of resending", () => {
  it.each([
    ["D16", true],
    ["D17", true],
    ["D15", false],
    ["D18", false],
    ["D4", false],
  ] as const)("answers %s with %s", (state, expected) => {
    expect(retryRecoversLatest(state)).toBe(expected);
  });
});
