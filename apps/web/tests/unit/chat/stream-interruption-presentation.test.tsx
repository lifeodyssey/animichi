/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamInterruption } from "../../../src/features/chat/components/ErrorStates/StreamInterruption";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const dict = chatDictFor("zh"), copy = dict.errorStates;
afterEach(cleanup);

describe("interruption recovery feedback", () => {
  it("announces loading politely while retaining the focused action and its retry boundary", () => {
    const onRetry = vi.fn(), props = { state: "D4" as const, dict, onRetry };
    const view = render(<StreamInterruption {...props} />);
    const button = screen.getByRole<HTMLButtonElement>("button", { name: copy.d4Retry });
    button.focus();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<StreamInterruption {...props} recovering />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(copy.interruptionRecovering);
    expect(screen.getByRole("button")).toBe(button);
    expect(button).toBe(document.activeElement);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<StreamInterruption {...props} />);
    expect(screen.getByRole("alert").textContent).toContain(copy.d4Message);
    expect(button.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not announce recovery merely because a retry was clicked", () => {
    render(<StreamInterruption state="D15" dict={dict} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(copy.d15Message);
  });

  it.each(LOCALES)("connects the action to localized recovery feedback in %s", (locale) => {
    const localized = chatDictFor(locale);
    render(<StreamInterruption state="D16" dict={localized} onRetry={vi.fn()} recovering />);
    const descriptionId = screen.getByRole("button").getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descriptionId)?.textContent).toContain(localized.errorStates.interruptionRecovering);
    expect(screen.getByRole("status").textContent).toContain(localized.errorStates.interruptionRecoveringHint);
    expect(screen.getByRole("button", { name: localized.errorStates.d16Retry })).toBeTruthy();
  });
});

function errorDetails(): HTMLDetailsElement {
  const details = screen.getByText(copy.interruptionDetails).closest("details");
  if (!details) throw new Error("missing error details");
  return details;
}

describe("reportable error details", () => {
  it("keeps the original code behind a disclosure, including literal markup characters", () => {
    const errorCode = "gateway_<response>&_mismatch", props = { state: "D18" as const, dict, errorCode, onRetry: vi.fn() };
    const view = render(<StreamInterruption {...props} />);
    expect(errorDetails().open).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain(copy.d18Title);
    fireEvent.click(screen.getByText(copy.interruptionDetails));
    expect(errorDetails().open).toBe(true);
    expect(screen.getByText(copy.d18Message.replace("{code}", errorCode))).toBeTruthy();
    expect(document.querySelector("response")).toBeNull();
    view.rerender(<StreamInterruption {...props} recovering />);
    expect(errorDetails().open).toBe(true);
  });

  it("closes a previous disclosure when the error changes", () => {
    const props = { state: "D18" as const, dict, onRetry: vi.fn() };
    const view = render(<StreamInterruption {...props} errorCode="502" />);
    fireEvent.click(screen.getByText(copy.interruptionDetails));
    view.rerender(<StreamInterruption {...props} errorCode="contract_mismatch" />);
    expect(errorDetails().open).toBe(false);
    expect(screen.queryByText(copy.d18Message.replace("{code}", "502"))).toBeNull();
    expect(screen.getByText(copy.d18Message.replace("{code}", "contract_mismatch"))).toBeTruthy();
  });
});
