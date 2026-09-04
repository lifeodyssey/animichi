/**
 * W1-6 (#1255) against real PostgreSQL: a succeeded turn's settlement, proven
 * on the committed `migrations/neon` chain rather than on a double.
 *
 * Only a database can tell the truth about the two properties this settlement
 * exists for. Atomicity is the transaction itself, so a failure injected
 * between the run's terminal UPDATE and the day-total upsert must leave
 * NEITHER. Exactly-once is `usage_settled_at`, so a run whose usage already
 * landed adds nothing to `daily_usage` however often it is settled — that guard
 * is on the rollup marker rather than on the status column, which is why one
 * case here settles a run that still says `running`.
 *
 * The platform scope (#1292) is proven here for the same reason: WHICH day row
 * a turn's off-run translation lands on is a fact about `daily_usage_scope_check`
 * and the settling UPDATE's own RETURNING, and only a database holds both.
 *
 * Each case settles on its own UTC day, because `daily_usage` is a shared day
 * aggregate: a case that had to subtract the cases before it would pass while
 * banking the wrong number.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { settleSucceededTurn } from "../src/agent/settlement/neon-turn-settlement.ts";
import { NO_SUPPLEMENTAL_USAGE } from "../src/agent/settlement/supplemental-usage.ts";
import type { SettlementResult, SucceededTurn } from "../src/agent/settlement/turn-settlement.ts";
import type { AgentStatements, AgentTransactions } from "../src/db/agent-database.ts";
import { startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { bankedUsage, runSettlement, seedRun, type SeededRun } from "./agent-rows.ts";

const LEASED = "2026-09-02T23:31:00.000Z";
/** Cheap in, dearer out — the shape of the deployed model's own pricing. */
const PRICES = { inputUsdPerMtok: 0.3, outputUsdPerMtok: 1.2 };
/** 12,000 × 0.3 + 3,000 × 1.2 = 7,200 micro-USD. */
const USAGE = { requests: 2, inputTokens: 12_000, outputTokens: 3_000 };
const TURN_COST = "0.007200";
const ONE_TURN = { requests: 2, input_tokens: 12_000, output_tokens: 3_000, cost_usd: TURN_COST };
const NO_TURN = { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: "0.000000" };
/** One tool-less translation call: 400 × 0.3 + 100 × 1.2 = 240 micro-USD. */
const TRANSLATION = { requests: 1, inputTokens: 400, outputTokens: 100 };
const ONE_TRANSLATION = { requests: 1, input_tokens: 400, output_tokens: 100, cost_usd: "0.000240" };

/** The settling instant of one case, late enough in its day to catch a slip. */
function settlingAt(day: string): Date {
  return new Date(`${day}T23:30:00.000Z`);
}

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: 300_000 });
after(() => plane.stop(), { timeout: 60_000 });

function makeSucceededTurn(runId: string): SucceededTurn {
  return { runId, usage: USAGE, supplemental: NO_SUPPLEMENTAL_USAGE, prices: PRICES };
}

/** The same turn, having also translated a title on a tool-less call (#1292). */
function makeTranslatingTurn(runId: string): SucceededTurn {
  return { ...makeSucceededTurn(runId), supplemental: TRANSLATION };
}

/** Settle a turn that translated, on the plane's own transactions. */
function settleTranslating(runId: string, at: Date): Promise<SettlementResult> {
  return plane.transactions.run((one) => settleSucceededTurn(one, makeTranslatingTurn(runId), at));
}

/**
 * Settle on a transaction of its own. #1252 will open one that also carries the
 * assistant message; what this lane answers for is what the transaction leaves
 * behind when it commits, and when it does not.
 */
function settle(
  runId: string,
  at: Date,
  transactions: AgentTransactions = plane.transactions,
): Promise<SettlementResult> {
  return transactions.run((one) => settleSucceededTurn(one, makeSucceededTurn(runId), at));
}

/** Transactions whose second statement — the day-total upsert — always fails. */
function makeTransactionsFailingAfterTheRun(inner: AgentTransactions): AgentTransactions {
  return { run: (work) => inner.run((statements) => work(failingAfterOneStatement(statements))) };
}

function failingAfterOneStatement(statements: AgentStatements): AgentStatements {
  let executed = 0;
  return {
    execute: (query) => {
      executed += 1;
      return executed > 1
        ? Promise.reject(new Error("injected mid-transaction failure"))
        : statements.execute(query);
    },
  };
}

function makeRunningRun(sessionId: string, overrides: Partial<SeededRun> = {}): SeededRun {
  return { sessionId, status: "running", leaseExpiresAt: LEASED, ...overrides };
}

void test("a settled turn is terminal and priced, and its usage lands on the payer's day row", async () => {
  const day = "2026-09-02";
  const at = settlingAt(day);
  const runId = await seedRun(plane.database, makeRunningRun("settle-session"));
  assert.equal(await settle(runId, at), "settled");
  assert.deepEqual(await runSettlement(plane.database, runId), {
    status: "succeeded", failure_reason: null, input_tokens: 12_000, output_tokens: 3_000,
    cost_usd: TURN_COST, finished_ms: String(at.getTime()), settled_ms: String(at.getTime()),
    refunded_ms: null,
  });
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), ONE_TURN);
});

void test("the next turn of the same day is added to that row rather than replacing it", async () => {
  const day = "2026-09-03";
  const first = await seedRun(plane.database, makeRunningRun("first-turn-session"));
  const second = await seedRun(plane.database, makeRunningRun("second-turn-session"));
  await settle(first, settlingAt(day));
  await settle(second, settlingAt(day));
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), {
    requests: 4, input_tokens: 24_000, output_tokens: 6_000, cost_usd: "0.014400",
  });
});

void test("settling the same run twice banks its usage once", async () => {
  const day = "2026-09-04";
  const runId = await seedRun(plane.database, makeRunningRun("replayed-settle-session"));
  await settle(runId, settlingAt(day));
  const settled = await runSettlement(plane.database, runId);
  assert.equal(await settle(runId, settlingAt(day)), "already_settled");
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), ONE_TURN);
  assert.deepEqual(await runSettlement(plane.database, runId), settled);
});

void test("a run whose usage already landed is never rolled up again", async () => {
  const day = "2026-09-05";
  const seeded = makeRunningRun("marked-settle-session", { usageSettledAt: "2026-09-05T10:00:00.000Z" });
  const runId = await seedRun(plane.database, seeded);
  assert.equal(await settle(runId, settlingAt(day)), "already_settled");
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), NO_TURN);
  assert.equal((await runSettlement(plane.database, runId)).status, "running");
});

void test("a failure between the run update and the day total leaves neither", async () => {
  const day = "2026-09-06";
  const runId = await seedRun(plane.database, makeRunningRun("atomic-settle-session"));
  const failing = makeTransactionsFailingAfterTheRun(plane.transactions);
  await assert.rejects(settle(runId, settlingAt(day), failing), /injected mid-transaction/);
  assert.equal((await runSettlement(plane.database, runId)).status, "running");
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), NO_TURN);
});

void test("a BYOK turn is metered in its own scope, at no cost to the platform", async () => {
  const day = "2026-09-07";
  const runId = await seedRun(plane.database, makeRunningRun("byok-settle-session", { payer: "byok" }));
  assert.equal(await settle(runId, settlingAt(day)), "settled");
  assert.equal((await runSettlement(plane.database, runId)).cost_usd, "0.000000");
  assert.deepEqual(await bankedUsage(plane.database, "byok", day), { ...ONE_TURN, cost_usd: "0.000000" });
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), NO_TURN);
});

void test("a caller-keyed turn's translation is banked on the platform, never on the caller", async () => {
  const day = "2026-09-08";
  const runId = await seedRun(plane.database, makeRunningRun("byok-translating-session", { payer: "byok" }));
  assert.equal(await settleTranslating(runId, settlingAt(day)), "settled");
  assert.deepEqual(await bankedUsage(plane.database, "byok", day), { ...ONE_TURN, cost_usd: "0.000000" });
  assert.deepEqual(await bankedUsage(plane.database, "platform", day), ONE_TRANSLATION);
});

void test("a plain turn's translation lands on the turn's own scope", async () => {
  const day = "2026-09-09";
  const runId = await seedRun(plane.database, makeRunningRun("plain-translating-session"));
  assert.equal(await settleTranslating(runId, settlingAt(day)), "settled");
  assert.deepEqual(await bankedUsage(plane.database, "anon", day), {
    requests: 3, input_tokens: 12_400, output_tokens: 3_100, cost_usd: "0.007440",
  });
  assert.deepEqual(await bankedUsage(plane.database, "platform", day), NO_TURN);
});

void test("a replayed settlement banks the translation once", async () => {
  const day = "2026-09-10";
  const seeded = makeRunningRun("replayed-translating-session", { payer: "byok" });
  const runId = await seedRun(plane.database, seeded);
  await settleTranslating(runId, settlingAt(day));
  assert.equal(await settleTranslating(runId, settlingAt(day)), "already_settled");
  assert.deepEqual(await bankedUsage(plane.database, "platform", day), ONE_TRANSLATION);
});
