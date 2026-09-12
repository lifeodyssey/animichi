import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatDict } from "../i18n";
import { currentRuntimeConfig } from "../../../lib/runtime-config/provider";
import { clearTurnstileToken, rememberTurnstileToken } from "../../../lib/turnstile/token-store";
import { TurnstilePresentation, type TurnstileView } from "./TurnstilePresentation";
import { useTurnstileEmbed, type TurnstileApi, type TurnstileConfig } from "./turnstile-sdk";

export { TURNSTILE_SCRIPT_SRC } from "./turnstile-sdk";

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
 * Appearance controls visibility, separately from execution timing. `interaction-only`
 * solves silently and renders NOTHING unless Cloudflare actually decides a
 * human interaction is required. The full-viewport entry therefore stays
 * visually quiet unless Cloudflare actually asks for human interaction.
 */
export const TURNSTILE_APPEARANCE = "interaction-only";

/** Default size; the embed uses compact when its actual container is below 300px. */
export const TURNSTILE_SIZE = "flexible";

/** A Turnstile site key is 24 characters; a secret is 35. */
const SITE_KEY_LENGTH = 24;

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
    onAnimichiTurnstileError?: () => void;
    onAnimichiTurnstileExpired?: () => void;
    onAnimichiTurnstileInteractive?: () => void;
    onAnimichiTurnstileInteractiveEnd?: () => void;
    turnstile?: TurnstileApi;
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

/**
 * Read the public site key, failing loudly on the wrong shape. A 35-character
 * value is the SECRET: pasting it into the public slot would ship it in the
 * client bundle, so that mistake must never reach a render.
 */
export function resolveTurnstileSiteKey(siteKey: string | undefined): string {
  const value = siteKey ?? "";
  if (value.length !== SITE_KEY_LENGTH) throw siteKeyError(value.length);
  return value;
}

/** Reports the offending LENGTH only — never the value itself. */
function siteKeyError(actualLength: number): Error {
  return new Error(
    `turnstileSiteKey must be ${String(SITE_KEY_LENGTH)} characters ` +
      `(got ${String(actualLength)}). ` +
      "A 35-character value is the Turnstile SECRET and must never reach the client.",
  );
}

export function currentTurnstileSiteKey(): string {
  return resolveTurnstileSiteKey(currentRuntimeConfig().turnstileSiteKey);
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
  siteKey: string | undefined = currentRuntimeConfig().turnstileSiteKey,
  dev: boolean = import.meta.env.DEV,
): string | undefined {
  if (siteKey !== undefined && siteKey.length > 0) return resolveTurnstileSiteKey(siteKey);
  return dev ? TURNSTILE_TEST_SITE_KEY : undefined;
}

/** Match the widget to the app's own day/night choice rather than the OS's. */
function widgetTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "night" ? "dark" : "light";
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

function bindInvalidation(onInvalid: (() => void) | undefined): () => void {
  const invalidate = () => { clearTurnstileToken(); onInvalid?.(); };
  window.onAnimichiTurnstileError = invalidate;
  window.onAnimichiTurnstileExpired = invalidate;
  return () => {
    window.onAnimichiTurnstileError = undefined;
    window.onAnimichiTurnstileExpired = undefined;
  };
}

/** Drop the held token whenever the widget says it is no longer good. */
function useTurnstileInvalidation(onInvalid: (() => void) | undefined): void {
  useEffect(() => bindInvalidation(onInvalid), [onInvalid]);
}

type Props = Readonly<{
  dict: ChatDict;
  siteKey: string;
  failed?: boolean;
  onRetry?: () => void;
  onToken?: (token: string) => void;
  onInvalid?: () => void;
}>;

/** The attributes api.js reads that never vary between renders. */
const WIDGET_ATTRIBUTES = {
  "data-action": TURNSTILE_ACTION,
  "data-callback": TURNSTILE_CALLBACK,
  "data-error-callback": TURNSTILE_ERROR_CALLBACK,
  "data-expired-callback": TURNSTILE_EXPIRED_CALLBACK,
  "data-timeout-callback": TURNSTILE_ERROR_CALLBACK,
  "data-before-interactive-callback": "onAnimichiTurnstileInteractive",
  "data-after-interactive-callback": "onAnimichiTurnstileInteractiveEnd",
  "data-appearance": TURNSTILE_APPEARANCE,
  "data-size": TURNSTILE_SIZE,
} as const;

function TurnstileWidget({ siteKey, language, attempt }: Readonly<{ siteKey: string; language: string; attempt: number }>) {
  const ref = useRef<HTMLDivElement>(null), theme = widgetTheme();
  const config = useMemo<TurnstileConfig>(() => ({ sitekey: siteKey, action: TURNSTILE_ACTION, appearance: TURNSTILE_APPEARANCE, theme, language }), [siteKey, theme, language]);
  useTurnstileEmbed(ref, config, attempt);
  return <div ref={ref} className="cf-turnstile [display:flex] w-full min-w-0 justify-center" data-sitekey={siteKey} data-theme={theme} data-language={language} {...WIDGET_ATTRIBUTES} />;
}

function useInteractiveState(setState: Dispatch<SetStateAction<TurnstileView>>): void {
  useEffect(() => {
    window.onAnimichiTurnstileInteractive = () => { setState("interactive"); };
    window.onAnimichiTurnstileInteractiveEnd = () => { setState(current => current === "interactive" ? "checking" : current); };
    return () => { window.onAnimichiTurnstileInteractive = undefined; window.onAnimichiTurnstileInteractiveEnd = undefined; };
  }, [setState]);
}

function useTurnstileView(onToken: Props["onToken"], onInvalid: Props["onInvalid"]) {
  const [state, setState] = useState<TurnstileView>("checking");
  const solved = useCallback((token: string) => { setState("verifying"); (onToken ?? rememberTurnstileToken)(token); }, [onToken]);
  const invalid = useCallback(() => { setState("failed"); onInvalid?.(); }, [onInvalid]);
  useTurnstileCallback(solved); useTurnstileInvalidation(invalid); useInteractiveState(setState);
  return { state, setState };
}

function useWidgetRetry(onRetry: Props["onRetry"], setState: (state: TurnstileView) => void) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState("checking");
    if (!window.turnstile?.render) setAttempt(value => value + 1);
    (onRetry ?? resetTurnstileWidget)();
  }, [onRetry, setState]);
  return { attempt, retry };
}

/** A widget token only advances to awaiting server confirmation, never an admitted state. */
export function TurnstileGate({ dict, siteKey, failed = false, onRetry, onToken, onInvalid }: Props) {
  const view = useTurnstileView(onToken, onInvalid), retry = useWidgetRetry(onRetry, view.setState);
  return <TurnstilePresentation dict={dict} state={failed ? "failed" : view.state} onRetry={retry.retry}>
    <TurnstileWidget siteKey={siteKey} language={dict.locale === "zh" ? "zh-cn" : dict.locale} attempt={retry.attempt} />
  </TurnstilePresentation>;
}
