import { useCallback, useEffect, useMemo, useState } from "react";
import { configuredTurnstileSiteKey, resetTurnstileWidget } from "../../components/TurnstileGate";
import { getAuthToken } from "../../lib/auth/authSession";
import {
  awaitTurnstileToken,
  clearTurnstileToken,
  currentTurnstileToken,
  onTurnstileToken,
} from "../../lib/turnstile/tokenStore";
import { TURNSTILE_REQUIRED_CODE } from "../../lib/chat/errorClassifier";
import type { ChatSession } from "./use-chat-session";

export interface TurnstileChallenge {
  readonly siteKey: string;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** True once we know this visitor holds no session — only anonymous turns are
 * challenged, so a signed-in reader never loads the widget at all. */
function trackAnonymous(setAnonymous: (anonymous: boolean) => void): () => void {
  let live = true;
  void getAuthToken().then((token) => {
    if (live) setAnonymous(token === undefined);
  });
  return () => { live = false; };
}

function useAnonymousVisitor(): boolean {
  const [anonymous, setAnonymous] = useState(false);
  useEffect(() => trackAnonymous(setAnonymous), []);
  return anonymous;
}

/**
 * Retry the rejected turn — driven by the WIDGET, not by the click.
 *
 * The rejected token is spent (single-use at siteverify), so it is dropped and
 * the widget re-armed; the resend then waits for the callback that delivers the
 * replacement. Resending in the same tick would put a tokenless request on the
 * wire and earn the identical 403 (issue #447 review, P1-1). The subscription
 * is taken BEFORE the reset so a fast solve cannot land in the gap, and no
 * token means no resend: the challenge simply stays on screen.
 */
function resendWhenSolved(regenerate: () => Promise<void> | void): void {
  clearTurnstileToken();
  const replacement = awaitTurnstileToken();
  resetTurnstileWidget();
  void replacement.then((token) => {
    if (token !== undefined) void regenerate();
  });
}

function useChallengeRetry(chat: ChatSession): () => void {
  const { clearError, regenerate } = chat;
  return useCallback(() => {
    clearError();
    resendWhenSolved(regenerate);
  }, [clearError, regenerate]);
}

/**
 * True once a turn may be sent without walking into a 403: either no challenge
 * is in play on this page, or the widget has already handed over a token.
 *
 * `?q=` auto-send (A2) is gated on this. Firing the hero's query the instant
 * the page mounts would race the widget's first solve, and the armed edge
 * requires the token on the FIRST message — the visitor would land on an
 * unrecoverable 403 (issue #447 review, P1-1).
 */
export function useTurnstileReady(challenged: boolean): boolean {
  const [held, setHeld] = useState(() => currentTurnstileToken() !== undefined);
  useEffect(() => onTurnstileToken(() => { setHeld(true); }), []);
  return !challenged || held;
}

/**
 * The anonymous chat entry's Turnstile state, or `undefined` when no widget
 * belongs on the page (signed in, or no site key configured in this build).
 */
export function useTurnstileChallenge(chat: ChatSession): TurnstileChallenge | undefined {
  const anonymous = useAnonymousVisitor();
  const siteKey = useMemo(() => configuredTurnstileSiteKey(), []);
  const onRetry = useChallengeRetry(chat);
  if (!anonymous || siteKey === undefined) return undefined;
  return { siteKey, failed: chat.lastErrorCode() === TURNSTILE_REQUIRED_CODE, onRetry };
}
