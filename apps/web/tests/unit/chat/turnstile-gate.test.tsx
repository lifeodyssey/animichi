/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ACTION,
  TURNSTILE_CALLBACK,
  TURNSTILE_SCRIPT_SRC,
  TurnstileGate,
  currentTurnstileSiteKey,
  resolveTurnstileSiteKey,
} from "../../../src/components/TurnstileGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const ja = chatDictFor("ja");

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((node) => {
    node.remove();
  });
});

function widget(): Element {
  const node = document.querySelector(".cf-turnstile");
  if (node === null) throw new Error("cf-turnstile widget was not rendered");
  return node;
}

describe("site key shape assertion", () => {
  it("accepts a 24-character site key", () => {
    expect(resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: SITE_KEY })).toBe(SITE_KEY);
  });

  it("rejects a 35-character value — that length is the SECRET", () => {
    const secretShaped = "x".repeat(35);
    expect(() => resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: secretShaped })).toThrow(/SECRET/);
  });

  it("rejects a missing site key", () => {
    expect(() => resolveTurnstileSiteKey({})).toThrow(/24 characters/);
  });

  it("never echoes the offending value in the error message", () => {
    const secretShaped = "WRONG-LENGTH-VALUE-NOT-A-SITE-KEY";
    const read = () => resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: secretShaped });
    expect(read).toThrow(/must be 24 characters/);
    expect(read).not.toThrow(new RegExp(secretShaped));
  });

  it("currentTurnstileSiteKey reads VITE_TURNSTILE_SITE_KEY from the bundle env", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY);
    expect(currentTurnstileSiteKey()).toBe(SITE_KEY);
  });

  it("currentTurnstileSiteKey fails loudly when the env slot is empty", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    expect(() => currentTurnstileSiteKey()).toThrow(/24 characters/);
  });
});

describe("widget embed", () => {
  it("renders cf-turnstile with the site key and the mandatory data-action", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(widget().getAttribute("data-sitekey")).toBe(SITE_KEY);
    expect(widget().getAttribute("data-action")).toBe(TURNSTILE_ACTION);
    expect(widget().getAttribute("data-callback")).toBe(TURNSTILE_CALLBACK);
  });

  it("loads the official api.js once, async and deferred", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    const scripts = document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    expect(scripts).toHaveLength(1);
    const script = scripts[0] as HTMLScriptElement;
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
  });

  it("hands the solved token to the injected sink through the global callback", () => {
    const onToken = vi.fn();
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} onToken={onToken} />);
    window.onAnimichiTurnstile?.("solved-token");
    expect(onToken).toHaveBeenCalledWith("solved-token");
  });

  it("removes the global callback on unmount", () => {
    const view = render(<TurnstileGate dict={ja} siteKey={SITE_KEY} onToken={vi.fn()} />);
    view.unmount();
    expect(window.onAnimichiTurnstile).toBeUndefined();
  });
});

describe("AC4 retry copy renders per locale", () => {
  it.each(LOCALES)("shows the %s failure message and retry action", (locale) => {
    const dict = chatDictFor(locale);
    render(<TurnstileGate dict={dict} siteKey={SITE_KEY} failed onRetry={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(dict.turnstile.failed);
    expect(screen.getByRole("button", { name: dict.turnstile.retry })).toBeTruthy();
    expect(screen.getByLabelText(dict.turnstile.label)).toBeTruthy();
  });

  it("invokes onRetry when the retry action is pressed", () => {
    const onRetry = vi.fn();
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} failed onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows no retry prompt until the challenge actually fails", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tolerates a failed state without an onRetry handler", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} failed />);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
