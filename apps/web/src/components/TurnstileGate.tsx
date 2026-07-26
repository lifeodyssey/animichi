import { useEffect } from "react";
import type { ChatDict } from "../features/chat/i18n";
import { rememberTurnstileToken } from "../lib/turnstile/tokenStore";

/** Cloudflare's widget loader. `async defer` per the official embed. */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** Mandatory analytics attribution on every `cf-turnstile` element. */
export const TURNSTILE_ACTION = "turnstile-spin-v2";

/** Global the widget invokes with the solved token (`data-callback`). */
export const TURNSTILE_CALLBACK = "onAnimichiTurnstile";

/** A Turnstile site key is 24 characters; a secret is 35. */
const SITE_KEY_LENGTH = 24;

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
  }
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

function TurnstileWidget({ siteKey }: Readonly<{ siteKey: string }>) {
  return (
    <div
      className="cf-turnstile"
      data-sitekey={siteKey}
      data-action={TURNSTILE_ACTION}
      data-callback={TURNSTILE_CALLBACK}
    />
  );
}

/**
 * The Turnstile widget. Verification itself is server-side at the edge
 * (`worker/turnstile.ts`) — this only collects the token and hands it to the
 * store the chat transport reads.
 */
export function TurnstileGate({ dict, siteKey, failed = false, onRetry, onToken }: Props) {
  useTurnstileScript();
  useTurnstileCallback(onToken ?? rememberTurnstileToken);
  return (
    <section className="turnstile-gate" aria-label={dict.turnstile.label}>
      <TurnstileWidget siteKey={siteKey} />
      {failed ? <TurnstileRetry dict={dict} onRetry={onRetry ?? (() => undefined)} /> : null}
    </section>
  );
}
