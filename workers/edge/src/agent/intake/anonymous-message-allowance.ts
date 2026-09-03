/**
 * The per-identity anonymous daily message CEILING (issue #282 / S1.10), which
 * `quota-reservation.ts` deliberately left unowned: that module reserves a
 * message on `anon_daily_message_count`, and its header names this as the half
 * with no home in the TS path. The route switch (#1256) is that home.
 *
 * Ported from Python's `anonymous_quota_verdict`
 * (`apps/agent/src/animichi/application/admission_limits.py`), keeping its
 * semantics and not its shape:
 *  - `0` or unset DISABLES the ceiling, the same "0 disables" convention as the
 *    daily-dollar breaker beside it;
 *  - the refusal names the next UTC midnight, because `Retry-After` cannot say
 *    "today" in a timezone that is not the server's (`packages/contract`'s
 *    `AnonQuotaExhaustedData`);
 *  - identity eligibility is NOT restated here: `quotaReservationFor` already
 *    answers which identities the counter keys, and a second copy of that
 *    predicate is how the two would drift.
 *
 * WHERE THE VERDICT DIVERGES, on purpose: Python READ the counter, compared it
 * to the quota, and failed OPEN when the read errored — the increment came
 * later, at terminal. The TS intake reserves inside the turn's own transaction,
 * so the count this module judges is the one the reservation just returned.
 * There is no separate read to fail open on, and the comparison is therefore
 * post-increment: Python's `count >= quota` is this module's `reserved > quota`
 * on the same turn. A counter that cannot be written is a turn that cannot be
 * admitted at all, which is the transaction's answer, not this module's.
 */

/** How many messages one anonymous identity may reserve per UTC day; `0` = no
 * ceiling. Anything that is not a positive integer disables the check rather
 * than refusing every visitor — a typo in a var must not close the front door. */
export function anonymousMessageAllowance(raw: string | undefined): number {
  const parsed = Number(raw ?? "");
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

/** Whether the reservation just taken puts this identity past its allowance. */
export function allowanceExceeded(reserved: number, allowance: number): boolean {
  return allowance > 0 && reserved > allowance;
}

/** The next UTC midnight after `usageDate` (an ISO `YYYY-MM-DD` UTC day) — the
 * instant the counter row this turn charged stops applying. Rendered without
 * milliseconds, matching the container's own `%Y-%m-%dT%H:%M:%SZ`. */
export function quotaResetsAt(usageDate: string): string {
  const nextDay = new Date(`${usageDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return `${nextDay.toISOString().slice(0, 19)}Z`;
}

/**
 * The turn was refused because its identity has spent the day's allowance. It
 * is thrown from INSIDE the intake transaction, so the reservation, the run and
 * the message it would have committed roll back together — the visitor is told
 * "not today", and the turn leaves no trace to settle or refund.
 */
export class QuotaExhaustedError extends Error {
  /** When the allowance returns, as the 403 payload carries it. */
  readonly resetsAt: string;

  constructor(usageDate: string) {
    super("the anonymous daily message allowance is spent");
    this.name = "QuotaExhaustedError";
    this.resetsAt = quotaResetsAt(usageDate);
  }
}
