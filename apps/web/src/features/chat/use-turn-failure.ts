import { useCallback } from "react";
import { TURNSTILE_REQUIRED_CODE, classifyFailure } from "../../lib/chat/errorClassifier";
import type { ChatErrorState, FailureSignal } from "../../lib/chat/errorClassifier";
import type { AuthStatus } from "../../lib/auth/session";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { UNLOCKED, lockHolds, resetInstant, useQuotaRelease } from "./quota-lock";
import type { QuotaLock } from "./quota-lock";
import type { RecomputeTurn } from "./selection/useRecomputeTurn";
import type { ChatSession } from "./use-chat-session";
import { useStreamRecovery } from "./use-stream-recovery";
import { useTurnTimeout } from "./use-turn-timeout";

function turnFailureSignal(lastStatus: number | undefined, code: string | undefined): FailureSignal {
  if (lastStatus !== undefined && lastStatus >= 400) return { kind: "http", status: lastStatus, code };
  return { kind: "stream-abort" };
}

/** Only the four fields classification reads — so it is testable without a
 * whole `useChat` instance, and cannot quietly grow a new dependency. */
export type FailingTurn = Pick<ChatSession, "status" | "error" | "lastErrorCode" | "lastHttpStatus">;

function isActiveTurn(status: ChatSession["status"]): boolean {
  return status === "submitted" || status === "streaming";
}

/**
 * A challenged turn is NOT D8 — an anonymous visitor never had a session to
 * expire — but the strip is only suppressed when a widget is actually on the
 * page to offer the recovery. A misconfigured build (no site key, or an edge
 * with no secret) rejects every turn with nothing to click, so there the
 * generic failure must still render rather than the chat dying silently
 * (issue #447 review, P1-3).
 */
function suppressedByChallenge(code: string | undefined, challenged: boolean): boolean {
  return challenged && code === TURNSTILE_REQUIRED_CODE;
}

export function turnFailureState(chat: FailingTurn, timedOut: boolean, challenged: boolean): ChatErrorState | undefined {
  if (isActiveTurn(chat.status)) return undefined;
  if (timedOut) return "D5";
  if (chat.error === undefined) return undefined;
  const code = chat.lastErrorCode();
  if (suppressedByChallenge(code, challenged)) return undefined;
  return classifyFailure(turnFailureSignal(chat.lastHttpStatus(), code)) ?? "D4";
}

/**
 * The D12 lock, derived rather than stored: an authenticated identity is not
 * subject to the anonymous quota at all, so signing in releases the lock by
 * itself, and a `quota_resets_at` already in the past means a fresh quota day
 * began while the banner sat there — that identity starts the day at FULL
 * quota, so the lock must not outlive its own reset instant.
 */
export function quotaLockOf(
  chat: ChatSession,
  state: ChatErrorState | undefined,
  auth: AuthStatus,
  nowMs: number = Date.now(),
): QuotaLock {
  if (state !== "D12" || auth === "authenticated") return UNLOCKED;
  const lock = { locked: true, resetsAtMs: resetInstant(chat.lastQuotaResetsAt()) };
  return lockHolds(lock, nowMs) ? lock : UNLOCKED;
}

/** What the two gates need from the page: the armed challenge, and identity. */
export interface TurnFailureGate {
  readonly challenged: boolean;
  readonly auth: AuthStatus;
}

interface TurnFailure {
  readonly view: TurnFailureView | undefined;
  readonly quota: QuotaLock;
}

/** A released D12 stops being a failure at all — no banner, no lock. */
function surfacedState(state: ChatErrorState | undefined, quota: QuotaLock): ChatErrorState | undefined {
  return state === "D12" && !quota.locked ? undefined : state;
}

function useRelease(chat: ChatSession, quota: QuotaLock): void {
  const { clearError } = chat;
  useQuotaRelease(quota, useCallback(() => { clearError(); }, [clearError]));
}

type Timeout = ReturnType<typeof useTurnTimeout>;
type Recovery = ReturnType<typeof useStreamRecovery>;

function useRecoveryHandlers(timeout: Timeout, recovery: Recovery) {
  const onRetry = useCallback(() => { timeout.reset(); recovery.recover(); }, [timeout, recovery]);
  const onExpiredResume = useCallback(() => { timeout.reset(); recovery.recoverExpired(); }, [timeout, recovery]);
  return { onRetry, onExpiredResume, recovering: recovery.recovering };
}

type Handlers = ReturnType<typeof useRecoveryHandlers>;

function failureOf(state: ChatErrorState | undefined, quota: QuotaLock, handlers: Handlers): TurnFailure {
  if (state === undefined) return { view: undefined, quota };
  return { view: { state, quotaResetsAtMs: quota.resetsAtMs, ...handlers }, quota };
}

/** Compose the D4/D5/D8/D11/D12 view: watchdog + classification + P6 recovery. */
export function useTurnFailure(chat: ChatSession, baseUrl: string, gate: TurnFailureGate): TurnFailure {
  const timeout = useTurnTimeout(chat.status, () => void chat.stop());
  const recovery = useStreamRecovery(baseUrl, chat, chat.sessionIdOf);
  const classified = turnFailureState(chat, timeout.timedOut, gate.challenged);
  const quota = quotaLockOf(chat, classified, gate.auth);
  const handlers = useRecoveryHandlers(timeout, recovery);
  useRelease(chat, quota);
  return failureOf(surfacedState(classified, quota), quota, handlers);
}

/**
 * A failed recompute retries inline on the tray, never as a full-page D-state
 * — except D12, which the tray cannot recover from: its retry would re-send
 * the same bypass into the same exhausted quota forever. The quota banner and
 * its lock must surface even when the refusal arrived on a recompute turn.
 */
export function maskRecomputeFailure(
  recompute: RecomputeTurn,
  failure: TurnFailureView | undefined,
): TurnFailureView | undefined {
  if (failure?.state === "D12") return failure;
  return recompute.status === "failed" ? undefined : failure;
}
