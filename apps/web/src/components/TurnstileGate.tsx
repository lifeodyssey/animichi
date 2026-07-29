import { useEffect } from "react";
import type { ChatDict } from "../features/chat/i18n";
import { clearTurnstileToken, rememberTurnstileToken } from "../lib/turnstile/tokenStore";

/** Cloudflare's widget loader. `async defer` per the official embed. */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** Mandatory analytics attribution on every `cf-turnstile` element. */
export const TURNSTILE_ACTION = "turnstile-spin-v2";

/** Global the widget invokes with the solved token (`data-callback`). */
export const TURNSTILE_CALLBACK = "onAnimichiTurnstile";

/**
 * Globals for the two ways a token stops being usable: the challenge failed or
 * the loader never came up (`data-error-callback`), and the solved token aged
 * out (`data-expired-callback`). Both clear the store, so the next turn waits
 * for a fresh solve instead of sending a token the edge will reject.
 */
export const TURNSTILE_ERROR_CALLBACK = "onAnimichiTurnstileError";
export const TURNSTILE_EXPIRED_CALLBACK = "onAnimichiTurnstileExpired";

/**
 * The least intrusive of Turnstile's three appearances.
 *
 * `always` parks a permanent challenge box under the composer; `execute` needs
 * an explicit `turnstile.execute()` handshake before a token exists, which
 * would put a round trip in front of the very first message. `interaction-only`
 * solves silently and renders NOTHING unless Cloudflare actually decides a
 * human interaction is required — so the dock keeps the design's rhythm
 * (composer + one quiet hint line) on the overwhelming majority of turns, and
 * the challenge appears only in the rare case it is genuinely needed.
 */
export const TURNSTILE_APPEARANCE = "interaction-only";

/** Fills the composer's width instead of a fixed 300px box when it does show. */
export const TURNSTILE_SIZE = "flexible";

/** A Turnstile site key is 24 characters; a secret is 35. */
const SITE_KEY_LENGTH = 24;

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
    onAnimichiTurnstileError?: () => void;
    onAnimichiTurnstileExpired?: () => void;
    /** Injected by api.js; only `reset` is used (re-arm after a rejection). */
    turnstile?: { reset: (widget?: string) => void };
  }
}

/**
 * Re-arm the widget after the edge rejected a token (403 `turnstile_required`).
 * A Turnstile token is single-use at siteverify, so a retry that reuses the
 * held token would be rejected again as `timeout-or-duplicate`.
 */
export function resetTurnstileWidget(): void {
  window.turnstile?.reset();
}

type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * Read the public site key, failing loudly on the wrong shape. A 35-character
 * value is the SECRET: pasting it into the public slot would ship it in the
 * client bundle, so that mistake must never reach a render.
 */
export function resolveTurnstileSiteKey(env: EnvRecord): string {
  const siteKey = env.VITE_TURNSTILE_SITE_KEY ?? "";
  if (siteKey.length !== SITE_KEY_LENGTH) throw siteKeyError(siteKey.length);
  return siteKey;
}

/** Reports the offending LENGTH only — never the value itself. */
function siteKeyError(actualLength: number): Error {
  return new Error(
    `VITE_TURNSTILE_SITE_KEY must be ${String(SITE_KEY_LENGTH)} characters ` +
      `(got ${String(actualLength)}). ` +
      "A 35-character value is the Turnstile SECRET and must never reach the client.",
  );
}

export function currentTurnstileSiteKey(): string {
  return resolveTurnstileSiteKey(import.meta.env);
}

/**
 * Cloudflare's published always-passing TEST site key. Used only as the dev
 * fallback below, so `pnpm dev` and the E2E run exercise the real armed path
 * (issue #447) without anyone provisioning a widget.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/**
 * The site key to render with, or `undefined` when this build has none.
 *
 * An unconfigured PRODUCTION build renders no widget rather than crashing the
 * chat page; an unconfigured DEV build falls back to the test key, because the
 * edge now challenges every anonymous turn and a local page with no widget
 * could never answer. A present-but-wrong-length value still throws in both:
 * pasting the 35-char SECRET must never reach a render.
 */
export function configuredTurnstileSiteKey(
  env: EnvRecord = import.meta.env,
  dev: boolean = import.meta.env.DEV,
): string | undefined {
  if ((env.VITE_TURNSTILE_SITE_KEY ?? "") !== "") return resolveTurnstileSiteKey(env);
  return dev ? TURNSTILE_TEST_SITE_KEY : undefined;
}

/** Match the widget to the app's own day/night choice rather than the OS's. */
function widgetTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "night" ? "dark" : "light";
}

/** Inject the loader once per document. */
function useTurnstileScript(): void {
  useEffect(() => {
    if (document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`) !== null) return;
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, []);
}

/** Expose the solved-token callback under a stable global name. */
function useTurnstileCallback(onToken: (token: string) => void): void {
  useEffect(() => {
    window.onAnimichiTurnstile = onToken;
    return () => {
      window.onAnimichiTurnstile = undefined;
    };
  }, [onToken]);
}

function bindInvalidation(): () => void {
  const invalidate = () => { clearTurnstileToken(); };
  window.onAnimichiTurnstileError = invalidate;
  window.onAnimichiTurnstileExpired = invalidate;
  return () => {
    window.onAnimichiTurnstileError = undefined;
    window.onAnimichiTurnstileExpired = undefined;
  };
}

/** Drop the held token whenever the widget says it is no longer good. */
function useTurnstileInvalidation(): void {
  useEffect(bindInvalidation, []);
}

type RetryProps = Readonly<{ dict: ChatDict; onRetry: () => void }>;

function TurnstileRetry({ dict, onRetry }: RetryProps) {
  return (
    <div className="turnstile-gate__error" role="alert">
      <span>{dict.turnstile.failed}</span>
      <button type="button" className="turnstile-gate__retry" onClick={onRetry}>
        {dict.turnstile.retry}
      </button>
    </div>
  );
}

type Props = Readonly<{
  dict: ChatDict;
  siteKey: string;
  failed?: boolean;
  onRetry?: () => void;
  onToken?: (token: string) => void;
}>;

/** The attributes api.js reads that never vary between renders. */
const WIDGET_ATTRIBUTES = {
  "data-action": TURNSTILE_ACTION,
  "data-callback": TURNSTILE_CALLBACK,
  "data-error-callback": TURNSTILE_ERROR_CALLBACK,
  "data-expired-callback": TURNSTILE_EXPIRED_CALLBACK,
  "data-appearance": TURNSTILE_APPEARANCE,
  "data-size": TURNSTILE_SIZE,
} as const;

function TurnstileWidget({ siteKey }: Readonly<{ siteKey: string }>) {
  return (
    <div className="cf-turnstile" data-sitekey={siteKey} data-theme={widgetTheme()} {...WIDGET_ATTRIBUTES} />
  );
}

/**
 * The Turnstile widget. Verification itself is server-side at the edge
 * (`worker/turnstile.ts`) — this only collects the token and hands it to the
 * store the chat transport reads.
 */
function useTurnstileWidget(onToken: ((token: string) => void) | undefined): void {
  useTurnstileScript();
  useTurnstileCallback(onToken ?? rememberTurnstileToken);
  useTurnstileInvalidation();
}

export function TurnstileGate({ dict, siteKey, failed = false, onRetry, onToken }: Props) {
  useTurnstileWidget(onToken);
  return (
    <section className="turnstile-gate" aria-label={dict.turnstile.label}>
      <TurnstileWidget siteKey={siteKey} />
      {failed ? <TurnstileRetry dict={dict} onRetry={onRetry ?? (() => undefined)} /> : null}
    </section>
  );
}
