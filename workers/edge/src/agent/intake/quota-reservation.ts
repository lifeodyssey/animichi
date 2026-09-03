/**
 * Which turns charge the per-identity daily message quota (issue #282 / S1.10),
 * and which `anon_daily_message_count` row they charge.
 *
 * Ported from the Python intake, not copied: `anon_quota_eligible`
 * (`apps/agent/src/animichi/application/admission_limits.py`) says only an
 * `anon_<32 hex>` identity is keyed by that counter — quota correctness never
 * depends on the caller being bug-free — and `utc_today` says the counter is
 * keyed on the UTC calendar day. What changes in the TS intake is WHEN the
 * counter moves: Python incremented at terminal, the run row now carries a
 * reservation taken in the intake transaction.
 *
 * NOT the admission gate. The Python surface also REFUSED a turn once the
 * counter reached `ANON_DAILY_MESSAGE_QUOTA` (`anonymous_quota_verdict` in the
 * same module), and that half has no home in the TS path yet — the container
 * ingress that ran it leaves with `apps/agent`, and the only place that can
 * answer a visitor with a refusal is the route (#1256). This module reserves;
 * nothing here rejects. Losing the ceiling silently is the failure mode, so it
 * is written down here rather than left to be noticed in production.
 *
 * The coordinates travel with the run (`runs.quota_identity_id` /
 * `runs.quota_usage_date`, NULL together when the turn is not metered —
 * `runs_quota_reservation_check`), so a turn that finishes after UTC midnight
 * refunds the day it charged rather than the day it ended.
 */
import type { RunPayer } from "../../db/schema.ts";

/** The exact counter row one turn reserves a message in. */
export interface QuotaReservation {
  readonly identityId: string;
  /** `anon_daily_message_count.usage_date`, an ISO `YYYY-MM-DD` UTC day. */
  readonly usageDate: string;
}

/** The edge's anonymous identity shape (`src/identity/anonymous-id.ts`). */
const METERED_IDENTITY = /^anon_[0-9a-f]{32}$/;

/** The UTC calendar day `anon_daily_message_count` and `daily_usage` share. */
export function utcUsageDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The reservation a submission takes, or `null` when nothing is metered: a
 * signed-in visitor is counted by no daily-message quota, and a BYOK turn
 * spends the visitor's own key.
 */
export function quotaReservationFor(
  payer: RunPayer,
  identityId: string,
  nowMs: number,
): QuotaReservation | null {
  if (payer !== "anon" || !METERED_IDENTITY.test(identityId)) return null;
  return { identityId, usageDate: utcUsageDate(nowMs) };
}
