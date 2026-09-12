/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TURNSTILE_SCRIPT_SRC, TURNSTILE_TEST_SITE_KEY, TurnstileGate } from "../../../src/features/chat/components/TurnstileGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { installTurnstileSdk } from "./turnstile-sdk-fixture";

const dict = chatDictFor("zh");
function script(): HTMLScriptElement {
  const node = document.head.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
  if (!node) throw new Error("The official script was not requested");
  return node;
}
afterEach(() => {
  cleanup(); window.turnstile = undefined;
  document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`).forEach(node => { node.remove(); });
});

describe("SDK loading and recovery", () => {
  it("reports a script failure and lets a user reload the SDK", async () => {
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} />);
    const failedScript = script();
    await act(async () => { failedScript.dispatchEvent(new Event("error")); await Promise.resolve(); });
    expect(screen.getByRole("alert").textContent).toContain(dict.turnstile.failed);
    fireEvent.click(screen.getByRole("button", { name: dict.turnstile.retry }));
    expect(script()).not.toBe(failedScript);
    expect(failedScript.isConnected).toBe(false);
    const sdk = installTurnstileSdk();
    await act(async () => { script().dispatchEvent(new Event("load")); await Promise.resolve(); });
    expect(sdk.render).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain(dict.turnstile.checkingTitle);
  });

  it("does not mount a widget if the component leaves before the SDK loads", async () => {
    const view = render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} />);
    view.unmount();
    const sdk = installTurnstileSdk();
    await act(async () => { script().dispatchEvent(new Event("load")); await Promise.resolve(); });
    expect(sdk.render).not.toHaveBeenCalled();
  });

  it("reports a vendor render failure instead of leaving the visitor waiting", async () => {
    const sdk = installTurnstileSdk();
    sdk.render.mockImplementation(() => { throw new Error("test vendor failure"); });
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} />);
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain(dict.turnstile.failedTitle); });
  });
});
