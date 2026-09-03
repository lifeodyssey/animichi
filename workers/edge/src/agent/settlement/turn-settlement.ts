/**
 * What one settled turn costs, and which day row it charges (spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三: "结束 = assistant
 * message + usage 结算 + run=succeeded 同一 TX", issue #1255).
 *
 * The two decisions that are arithmetic rather than SQL live here; the
 * transaction itself is `neon-turn-settlement.ts`.
 *
 * Pricing is ported from the Python meter (`apps/agent`
 * `interfaces/usage_metering.py::usage_cost_usd`): per-million-token prices are
 * configuration — there is no per-model table in `apps/agent`, only the two
 * `MODEL_*_COST_PER_MTOK_USD` settings — and an unpriced model still meters its
 * tokens at zero cost. What changes is the arithmetic's type. `runs.cost_usd`
 * and `daily_usage.cost_usd` are `NUMERIC(14,6)`, so a turn is priced in whole
 * micro-USD and travels as the driver's decimal text; a float would carry a
 * different rounding into every day total it is added to (`src/db/schema.ts`:
 * money stays the driver's decimal string, never a float).
 *
 * The scope a turn charges is the run's OWN payer, read back out of the
 * settling UPDATE rather than supplied by the caller. `runs.payer` and
 * `daily_usage.scope` are one three-value domain (`RUN_PAYERS`), which is what
 * makes Python's `scope_for_identity` a no-op on this side: the intake already
 * classified the turn when it wrote the run, so settlement never re-derives a
 * scope from an identity it would have to be handed.
 */
import { RUN_PAYERS, type RunFailureReason, type RunPayer } from "../../db/schema.ts";

/** One turn's model usage, in the counts `daily_usage` accumulates. */
export interface TurnUsage {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Per-million-token prices; configuration, never literals in the logic. */
export interface UsagePrices {
  readonly inputUsdPerMtok: number;
  readonly outputUsdPerMtok: number;
}

/** The wrangler vars carrying those prices — the names the Python settings
 * already used, so one deployment configures one meter. */
export const PRICE_VARS = {
  input: "MODEL_INPUT_COST_PER_MTOK_USD",
  output: "MODEL_OUTPUT_COST_PER_MTOK_USD",
} as const;

/** A configured price, or zero. An unpriced model still meters its tokens —
 * the Python `usage_cost_usd` charged zero rather than refusing to record. */
function priceIn(env: Record<string, unknown>, name: string): number {
  const configured = Number(typeof env[name] === "string" ? env[name] : Number.NaN);
  return Number.isFinite(configured) && configured >= 0 ? configured : 0;
}

/** The prices one deployment charges its turns at. */
export function usagePricesIn(env: Record<string, unknown>): UsagePrices {
  return {
    inputUsdPerMtok: priceIn(env, PRICE_VARS.input),
    outputUsdPerMtok: priceIn(env, PRICE_VARS.output),
  };
}

/** The turn a success settlement closes: what it spent, and at what prices. */
export interface SucceededTurn {
  readonly runId: string;
  readonly usage: TurnUsage;
  readonly prices: UsagePrices;
}

/** The turn a failure settlement closes, with a reason from the bounded
 * vocabulary the client reads back (`runs_failure_reason_check`). */
export interface FailedTurn {
  readonly runId: string;
  readonly reason: RunFailureReason;
}

/**
 * Whether THIS call is the one that settled the turn.
 *
 * `already_settled` is the exactly-once answer, not a failure: the turn is
 * terminal, its usage was banked once and its reservation refunded once, and a
 * second settlement — an alarm retry, a sweep that re-armed a run someone else
 * had already finished — must add nothing to either.
 */
export type SettlementResult = "settled" | "already_settled";

/** One USD, as the whole micro-USD a `NUMERIC(14,6)` column counts. */
const MICRO_USD = 1_000_000;

/** Six fractional digits, the scale `daily_usage.cost_usd` is declared with. */
const MICRO_USD_DIGITS = 6;

/**
 * Price one turn's tokens, as decimal text.
 *
 * Tokens times a per-million-token price IS the price in micro-USD, so the
 * whole computation stays in the money column's own unit and rounds exactly
 * once, at the end.
 */
export function turnCostUsd(usage: TurnUsage, prices: UsagePrices): string {
  const priced =
    usage.inputTokens * prices.inputUsdPerMtok + usage.outputTokens * prices.outputUsdPerMtok;
  return microUsdText(Math.round(priced));
}

function microUsdText(micro: number): string {
  const dollars = String(Math.trunc(micro / MICRO_USD));
  const fraction = String(micro % MICRO_USD).padStart(MICRO_USD_DIGITS, "0");
  return `${dollars}.${fraction}`;
}

/** The run a settling UPDATE committed: the scope its usage charges, and the
 * money that landed on it. */
export interface SettledRun {
  readonly scope: RunPayer;
  readonly costUsd: string;
}

/**
 * Read the settling UPDATE's own RETURNING row.
 *
 * It throws rather than answering a partial: by the time the caller reads this
 * row the run is already terminal on this transaction, so a row that cannot be
 * read is a day total that would silently go missing, not a settlement to skip.
 * `daily_usage_scope_check` admits exactly `RUN_PAYERS`, so a payer outside
 * that domain is refused here rather than one statement later.
 */
export function settledRun(row: Record<string, unknown>): SettledRun {
  const { scope, cost_usd: costUsd } = row;
  if (!isRunPayer(scope) || typeof costUsd !== "string") {
    throw new Error("the settling update returned no readable payer and cost");
  }
  return { scope, costUsd };
}

function isRunPayer(value: unknown): value is RunPayer {
  return typeof value === "string" && (RUN_PAYERS as readonly string[]).includes(value);
}
