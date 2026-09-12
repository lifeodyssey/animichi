/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileGate, TURNSTILE_TEST_SITE_KEY } from "../../../src/features/chat/components/TurnstileGate";
import { TurnstilePresentation } from "../../../src/features/chat/components/TurnstilePresentation";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { clearTurnstileToken, currentTurnstileToken, rememberTurnstileToken } from "../../../src/lib/turnstile/token-store";
import { installTurnstileSdk, renderedOptions } from "./turnstile-sdk-fixture";

const dict = chatDictFor("zh"), copy = dict.turnstile;
afterEach(() => { cleanup(); window.turnstile = undefined; clearTurnstileToken(); });

describe("verification copy follows real SDK events", () => {
  it("announces required interaction, then awaits server confirmation after a token", async () => {
    const sdk = installTurnstileSdk(), onToken = vi.fn();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} onToken={onToken} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    expect(screen.getByRole("status").textContent).toContain(copy.checkingTitle);
    act(() => { renderedOptions(sdk)["before-interactive-callback"](); });
    expect(screen.getByRole("status").textContent).toContain(copy.interactiveTitle);
    act(() => { renderedOptions(sdk).callback("test-token"); renderedOptions(sdk)["after-interactive-callback"](); });
    expect(onToken).toHaveBeenCalledExactlyOnceWith("test-token");
    expect(screen.getByRole("status").textContent).toContain(copy.verifyingTitle);
    expect(currentTurnstileToken()).toBeUndefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["error-callback", "expired-callback", "timeout-callback"] as const)("clears tokens and exposes retry on %s", async callback => {
    const sdk = installTurnstileSdk(), onInvalid = vi.fn();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} onInvalid={onInvalid} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    rememberTurnstileToken("old-test-token");
    act(() => { renderedOptions(sdk)[callback](); });
    expect(currentTurnstileToken()).toBeUndefined();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    const retry = screen.getByRole("button", { name: copy.retry });
    expect(retry.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(document.activeElement).not.toBe(retry);
    fireEvent.click(retry);
    expect(sdk.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain(copy.checkingTitle);
  });
});

describe("verification recovery controls", () => {
  it("keeps a server rejection visible even after a local widget token", async () => {
    const sdk = installTurnstileSdk();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} failed />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    act(() => { renderedOptions(sdk).callback("test-token"); });
    expect(screen.getByRole("alert").textContent).toContain(copy.failedTitle);
  });

  it("uses one native Animal Island retry button with its associated error", () => {
    const onRetry = vi.fn();
    render(<TurnstilePresentation dict={dict} state="failed" onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: copy.retry });
    expect(retry.getAttribute("type")).toBe("button");
    expect(retry.className).toContain("animal-btn");
    expect(retry.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
