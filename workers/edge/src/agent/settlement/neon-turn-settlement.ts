/**
 * The settlement's one transaction, in SQL (issue #1255). A turn ends in a
 * single transaction the CALLER owns: the AgentSession DO (#1252) opens it,
 * inserts the assistant message it holds the transcript for, and calls one of
 * these two functions on the same statement handle — which is why they take
 * `AgentStatements` rather than `AgentTransactions` the way the intake's
 * `NeonTurnRecords` does. Spec §三: "结束 = assistant message + usage 结算 +
 * run=succeeded 同一 TX".
 *
 * Both settlements are exactly-once by construction rather than by convention,
 * and each guard is a column the database owns:
 * - success is guarded by `status = 'running' AND usage_settled_at IS NULL`, so
 *   a turn whose usage already went into `daily_usage` cannot be banked twice —
 *   the marker guards the ROLLUP independently of what the status column says;
 * - the refund is guarded by `quota_refunded_at IS NULL AND quota_identity_id
 *   IS NOT NULL`, so a turn refunds the message it reserved once, and a turn
 *   that reserved nothing (a signed-in or BYOK payer, `runs_quota_reservation_check`)
 *   refunds nothing at all.
 *
 * The refund is ONE data-modifying CTE rather than a read-then-write: the
 * marker update and the counter decrement have to be the same decision, and a
 * round trip between them would be both a race and — on a cross-ocean Neon hop
 * — the most expensive statement of the turn.
 *
 * The statements are `drizzle-orm` templates over the mapping in
 * `src/db/schema.ts` rather than the query builder, for the reason
 * `neon-turn-records.ts` gives: they must run on any Postgres driver, so
 * `agent-db-test/` proves the very statements Neon runs.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentStatements } from "../../db/agent-database.ts";
import { bareName } from "../../db/column-name.ts";
import { anonDailyMessageCount, dailyUsage, runs } from "../../db/schema.ts";
import { utcUsageDate } from "../intake/quota-reservation.ts";
import { isJsonRecord } from "../json-record.ts";
import {
  settledRun,
  turnCostUsd,
  type FailedTurn,
  type SettledRun,
  type SettlementResult,
  type SucceededTurn,
  type TurnUsage,
} from "./turn-settlement.ts";

/** The rows a success settlement may touch: this run, still running, and never
 * rolled up into a day total before. */
function unsettledRun(runId: string): SQL {
  return sql`${runs.id} = ${runId}
    and ${runs.status} = 'running'
    and ${runs.usageSettledAt} is null`;
}

/**
 * A BYOK turn spends the visitor's own key, so the platform prices it at zero —
 * the `UsagePrices(0, 0)` the Python applier substitutes for a non-platform
 * payer (`interfaces/outbox_dispatch.py`). The decision is made from the run's
 * OWN payer here, so a caller that priced a BYOK turn cannot bill it to us.
 */
function platformCost(turn: SucceededTurn): SQL {
  return sql`case when ${runs.payer} = 'byok' then 0
    else ${turnCostUsd(turn.usage, turn.prices)}::numeric end`;
}

/** Terminal, priced, and marked as rolled up — all of it, or none of it. */
function succeededColumns(turn: SucceededTurn, settledAt: string): SQL {
  return sql`${bareName(runs.status)} = 'succeeded',
    ${bareName(runs.finishedAt)} = ${settledAt},
    ${bareName(runs.leaseOwner)} = null,
    ${bareName(runs.leaseExpiresAt)} = null,
    ${bareName(runs.inputTokens)} = ${turn.usage.inputTokens},
    ${bareName(runs.outputTokens)} = ${turn.usage.outputTokens},
    ${bareName(runs.costUsd)} = ${platformCost(turn)},
    ${bareName(runs.usageSettledAt)} = ${settledAt}`;
}

/** The run's own scope and money come back from the UPDATE, so the day total is
 * built from what actually landed rather than from what was asked for. */
function markSucceeded(turn: SucceededTurn, at: Date): SQL {
  return sql`update ${runs} set ${succeededColumns(turn, at.toISOString())}
    where ${unsettledRun(turn.runId)}
    returning ${bareName(runs.payer)} as scope, ${runs.costUsd}::text as cost_usd`;
}

function usageColumns(): SQL {
  return sql`${bareName(dailyUsage.usageDate)}, ${bareName(dailyUsage.scope)},
    ${bareName(dailyUsage.requests)}, ${bareName(dailyUsage.inputTokens)},
    ${bareName(dailyUsage.outputTokens)}, ${bareName(dailyUsage.costUsd)},
    ${bareName(dailyUsage.updatedAt)}`;
}

/** Ported from the Python `_usage_patch`: a day row that already exists GAINS
 * this turn rather than being replaced by it. */
function addTurnToTheDay(): SQL {
  const day = dailyUsage;
  return sql`${bareName(day.requests)} = ${day.requests} + excluded.${bareName(day.requests)},
    ${bareName(day.inputTokens)} = ${day.inputTokens} + excluded.${bareName(day.inputTokens)},
    ${bareName(day.outputTokens)} = ${day.outputTokens} + excluded.${bareName(day.outputTokens)},
    ${bareName(day.costUsd)} = ${day.costUsd} + excluded.${bareName(day.costUsd)},
    ${bareName(day.updatedAt)} = now()`;
}

/** One turn into its payer's day row (Python `_usage_statement`). */
function bankDailyUsage(usage: TurnUsage, settled: SettledRun, day: string): SQL {
  return sql`insert into ${dailyUsage} (${usageColumns()})
    values (${day}, ${settled.scope}, ${usage.requests}, ${usage.inputTokens},
            ${usage.outputTokens}, ${settled.costUsd}::numeric, now())
    on conflict (${bareName(dailyUsage.usageDate)}, ${bareName(dailyUsage.scope)})
    do update set ${addTurnToTheDay()}`;
}

/** The failed turn's own row. `runs_failed_has_reason_check` makes the reason
 * part of the status, so they are set together or the row is refused. */
function markFailed(turn: FailedTurn, at: Date): SQL {
  return sql`update ${runs} set
      ${bareName(runs.status)} = 'failed',
      ${bareName(runs.failureReason)} = ${turn.reason},
      ${bareName(runs.finishedAt)} = ${at.toISOString()},
      ${bareName(runs.leaseOwner)} = null,
      ${bareName(runs.leaseExpiresAt)} = null
    where ${runs.id} = ${turn.runId} and ${runs.status} = 'running'
    returning ${bareName(runs.id)} as run_id`;
}

/** Exactly-once: the marker IS the WHERE clause, so a second call marks
 * nothing — and the coordinates it returns are the ones the intake recorded, so
 * a turn that ends after UTC midnight gives its message back to the day it
 * charged rather than to today. */
function markRefunded(runId: string, at: Date): SQL {
  return sql`update ${runs} set ${bareName(runs.quotaRefundedAt)} = ${at.toISOString()}
    where ${runs.id} = ${runId}
      and ${runs.quotaRefundedAt} is null
      and ${runs.quotaIdentityId} is not null
    returning ${bareName(runs.quotaIdentityId)} as anon_id,
              ${bareName(runs.quotaUsageDate)} as usage_date`;
}

/**
 * Give the reserved message back, in the same statement that claims the right
 * to. A counter row is a count of messages, so the decrement is clamped in SQL
 * — the column is where "never below zero" is true, and a second copy of that
 * rule in TypeScript would be a second source of truth for it. Marking a run
 * whose counter row has since been deleted refunds nothing, which is the
 * correct end state: there is no longer anything owed.
 */
function refundReservation(runId: string, at: Date): SQL {
  const counter = anonDailyMessageCount;
  return sql`with refunded as (${markRefunded(runId, at)})
    update ${counter} set
      ${bareName(counter.messageCount)} = greatest(${counter.messageCount} - 1, 0),
      ${bareName(counter.updatedAt)} = now()
    from refunded
    where ${counter.usageDate} = refunded.usage_date
      and ${counter.anonId} = refunded.anon_id`;
}

function committedRow(result: { rows: unknown[] }): Record<string, unknown> | undefined {
  return result.rows.find(isJsonRecord);
}

/**
 * End one turn as succeeded and bank its usage, on the caller's transaction.
 *
 * The day row is charged on the UTC day the turn SETTLES, which is the day the
 * Python meter charged too (`record_turn_usage`'s `utc_today()`); only the
 * quota reservation carries its own recorded day.
 */
export async function settleSucceededTurn(
  statements: AgentStatements,
  turn: SucceededTurn,
  at: Date,
): Promise<SettlementResult> {
  const committed = committedRow(await statements.execute(markSucceeded(turn, at)));
  if (committed === undefined) return "already_settled";
  const usage = bankDailyUsage(turn.usage, settledRun(committed), utcUsageDate(at.getTime()));
  await statements.execute(usage);
  return "settled";
}

/**
 * End one turn as failed and refund what it reserved, on the caller's
 * transaction.
 *
 * No `daily_usage` row: the Python meter banked a turn's usage only when the
 * turn produced a result (`interfaces/public_api.py`, `usage_items` is empty
 * when there is none), and a failed turn has none to report.
 */
export async function settleFailedTurn(
  statements: AgentStatements,
  turn: FailedTurn,
  at: Date,
): Promise<SettlementResult> {
  const committed = committedRow(await statements.execute(markFailed(turn, at)));
  if (committed === undefined) return "already_settled";
  await statements.execute(refundReservation(turn.runId, at));
  return "settled";
}
