/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ACTION,
  TURNSTILE_APPEARANCE,
  TURNSTILE_CALLBACK,
  TURNSTILE_ERROR_CALLBACK,
  TURNSTILE_EXPIRED_CALLBACK,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_SIZE,
  TURNSTILE_TEST_SITE_KEY,
  TurnstileGate,
  configuredTurnstileSiteKey,
  currentTurnstileSiteKey,
  resetTurnstileWidget,
  resolveTurnstileSiteKey,
} from "../../../src/components/TurnstileGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import {
  clearTurnstileToken,
  currentTurnstileToken,
  rememberTurnstileToken,
} from "../../../src/lib/turnstile/tokenStore";
import { LOCALES } from "../../../src/i18n/locales";

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const ja = chatDictFor("ja");

afterEach(() => {
  cleanup();
  clearTurnstileToken();
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

describe("optional site key (issue #447 mount decision)", () => {
  it("reports no site key for an unconfigured production build", () => {
    expect(configuredTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: "" }, false)).toBeUndefined();
    expect(configuredTurnstileSiteKey({}, false)).toBeUndefined();
  });

  it("falls back to Cloudflare's always-passing test key in dev", () => {
    expect(configuredTurnstileSiteKey({}, true)).toBe(TURNSTILE_TEST_SITE_KEY);
    expect(TURNSTILE_TEST_SITE_KEY).toHaveLength(24);
  });

  it("prefers a configured 24-character key over the dev fallback", () => {
    expect(configuredTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: SITE_KEY }, true)).toBe(SITE_KEY);
  });

  it("still throws on a secret-shaped value — a wrong key must never render", () => {
    expect(() => configuredTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: "x".repeat(35) }, true)).toThrow(/SECRET/);
  });
});

describe("the widget says a token is no longer good", () => {
  it("wires the error and expired callbacks Cloudflare invokes", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(widget().getAttribute("data-error-callback")).toBe(TURNSTILE_ERROR_CALLBACK);
    expect(widget().getAttribute("data-expired-callback")).toBe(TURNSTILE_EXPIRED_CALLBACK);
  });

  it("drops the held token when the challenge errors or the loader never comes up", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    rememberTurnstileToken("doomed-token");
    window.onAnimichiTurnstileError?.();
    expect(currentTurnstileToken()).toBeUndefined();
  });

  it("drops the held token once it expires, so no stale token is ever sent", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    rememberTurnstileToken("aged-token");
    window.onAnimichiTurnstileExpired?.();
    expect(currentTurnstileToken()).toBeUndefined();
  });

  it("removes both callbacks on unmount", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />).unmount();
    expect(window.onAnimichiTurnstileError).toBeUndefined();
    expect(window.onAnimichiTurnstileExpired).toBeUndefined();
  });
});

describe("re-arming after a rejection", () => {
  it("resets the widget so the retry does not replay a spent token", () => {
    const reset = vi.fn();
    window.turnstile = { reset };
    resetTurnstileWidget();
    expect(reset).toHaveBeenCalledTimes(1);
    window.turnstile = undefined;
  });

  it("is a no-op before the loader has defined the global", () => {
    window.turnstile = undefined;
    expect(() => { resetTurnstileWidget(); }).not.toThrow();
  });
});

describe("widget embed", () => {
  it("renders cf-turnstile with the site key and the mandatory data-action", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(widget().getAttribute("data-sitekey")).toBe(SITE_KEY);
    expect(widget().getAttribute("data-action")).toBe(TURNSTILE_ACTION);
    expect(widget().getAttribute("data-callback")).toBe(TURNSTILE_CALLBACK);
  });

  it("stays out of the way until a human check is genuinely required", () => {
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(TURNSTILE_APPEARANCE).toBe("interaction-only");
    expect(widget().getAttribute("data-appearance")).toBe(TURNSTILE_APPEARANCE);
    expect(widget().getAttribute("data-size")).toBe(TURNSTILE_SIZE);
  });

  it("follows the app's own day/night choice rather than the OS theme", () => {
    document.documentElement.dataset.theme = "night";
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(widget().getAttribute("data-theme")).toBe("dark");
    document.documentElement.dataset.theme = "day";
    cleanup();
    render(<TurnstileGate dict={ja} siteKey={SITE_KEY} />);
    expect(widget().getAttribute("data-theme")).toBe("light");
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
