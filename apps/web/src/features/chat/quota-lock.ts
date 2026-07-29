import { useEffect, useMemo } from "react";
import type { ChatActions } from "./chat-actions";
import type { RecomputeTurn } from "./selection/useRecomputeTurn";

/** The D12 composer lock (#282 S1.10) and the instant it lifts by itself. */
export interface QuotaLock {
  readonly locked: boolean;
  /** `quota_resets_at` as an epoch ms, when the payload carried a usable one. */
  readonly resetsAtMs: number | undefined;
}

export const UNLOCKED: QuotaLock = { locked: false, resetsAtMs: undefined };

/** Parse `quota_resets_at`; an unparseable instant is treated as absent. */
export function resetInstant(isoText: string | undefined): number | undefined {
  if (isoText === undefined) return undefined;
  const parsed = Date.parse(isoText);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Whether the lock should still be held at `nowMs`. A reset instant already in
 * the past means a new quota day began while the banner sat on screen — that
 * identity starts the day at FULL quota, so the lock must not survive it.
 */
export function lockHolds(lock: QuotaLock, nowMs: number): boolean {
  if (!lock.locked) return false;
  return lock.resetsAtMs === undefined || lock.resetsAtMs > nowMs;
}

/**
 * `setTimeout` stores its delay in a signed 32-bit int: anything past ~24.8
 * days overflows and fires *immediately*, which would release the lock the
 * instant it was taken. A reset that far out is not something a tab waits for,
 * so it is deliberately left unscheduled and the lock simply holds.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function releaseDelay(resetsAtMs: number | undefined, nowMs: number): number | undefined {
  if (resetsAtMs === undefined) return undefined;
  const delay = Math.max(0, resetsAtMs - nowMs);
  return delay > MAX_TIMEOUT_MS ? undefined : delay;
}

/**
 * Fire `onRelease` when the quota returns, so the lock has an exit that does
 * not require the visitor to log in or reload. Without it a D12 banner is a
 * dead end for the rest of the tab's life.
 */
export function useQuotaRelease(lock: QuotaLock, onRelease: () => void): void {
  const { locked, resetsAtMs } = lock;
  useEffect(() => {
    if (!locked) return;
    const delay = releaseDelay(resetsAtMs, Date.now());
    if (delay === undefined) return;
    const timer = setTimeout(onRelease, delay);
    return () => { clearTimeout(timer); };
  }, [locked, resetsAtMs, onRelease]);
}

function noop(): void {
  return undefined;
}

const LOCKED_ACTIONS: ChatActions = { send: noop, regenerate: noop, sendWithOrigin: noop };

/**
 * Withhold every turn-starting action while the quota lock holds. The lock
 * cannot live on the composer alone: `send`/`regenerate` reach six-plus card
 * consumers through `ChatActionsProvider` (clarify chips, the selection tray,
 * departure chips, envelope + short-route retries, photo upload), and each one
 * that leaked would be a full container round-trip the quota already refused.
 */
export function useLockedActions(actions: ChatActions, locked: boolean): ChatActions {
  return useMemo(() => (locked ? LOCKED_ACTIONS : actions), [actions, locked]);
}

/** The E2 tray's own send is a turn too, so the quota lock withholds it as well. */
export function lockedRecompute(recompute: RecomputeTurn, locked: boolean): RecomputeTurn {
  return locked ? { ...recompute, fire: () => undefined } : recompute;
}
