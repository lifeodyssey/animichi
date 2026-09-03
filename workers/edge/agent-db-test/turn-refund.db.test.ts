/**
 * W1-6 (#1255) against real PostgreSQL: a failed turn gives its reserved
 * message back, exactly once (spec §六 "配额回冲 exactly-once").
 *
 * The intake charges `anon_daily_message_count` when it opens the turn, so a
 * turn that never produced an answer has to hand that message back — and the
 * three ways that goes wrong are only observable against a real counter: a
 * second settlement refunding twice, a run with no reservation refunding
 * somebody else's message, and a counter driven below zero. The guard is
 * `quota_refunded_at`, not the run's status, which is why one case here settles
 * a run that still says `running` but is already marked refunded.
 *
 * Two of those three are where the card asked for pure-function units:
 * "never below zero" and "no refund without a reservation". They are asserted
 * HERE instead, because neither rule is expressible in TypeScript without
 * becoming a second, unenforced copy of a guard the column already owns
 * (`greatest(message_count - 1, 0)` and `quota_identity_id IS NOT NULL` in
 * `neon-turn-settlement.ts`). A unit test of a duplicated rule proves the copy,
 * not the behaviour; these cases prove the behaviour.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { settleFailedTurn } from "../src/agent/settlement/neon-turn-settlement.ts";
import type { SettlementResult } from "../src/agent/settlement/turn-settlement.ts";
import type { QuotaReservation } from "../src/agent/intake/quota-reservation.ts";
import { startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import {
  bankedUsage,
  reservedOn,
  runSettlement,
  seedReservedMessages,
  seedRun,
  type SeededRun,
} from "./agent-rows.ts";

/** The instant every failure settles at, and the day it charges back. */
const AT = new Date("2026-09-08T09:00:00.000Z");
const RESERVED_DAY = "2026-09-08";
const LEASED = "2026-09-08T08:59:00.000Z";

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: 300_000 });
after(() => plane.stop(), { timeout: 60_000 });

/** One anonymous identity per case: the counter row is its own subject. */
function makeReservation(identityId: string, usageDate = RESERVED_DAY): QuotaReservation {
  return { identityId, usageDate };
}

function makeRunningRun(sessionId: string, overrides: Partial<SeededRun> = {}): SeededRun {
  return { sessionId, status: "running", leaseExpiresAt: LEASED, ...overrides };
}

function settleFailed(runId: string, at: Date = AT): Promise<SettlementResult> {
  return plane.transactions.run((one) =>
    settleFailedTurn(one, { runId, reason: "provider_failed" }, at),
  );
}

/** A metered run whose message is already on the counter, as the intake left it. */
async function seedReservedRun(
  sessionId: string,
  reservation: QuotaReservation,
  reserved: number,
  overrides: Partial<SeededRun> = {},
): Promise<string> {
  await seedReservedMessages(plane.database, reservation, reserved);
  return seedRun(plane.database, makeRunningRun(sessionId, { reservation, ...overrides }));
}

void test("a failed turn is terminal with its reason, and gives back the message it reserved", async () => {
  const reservation = makeReservation("anon_000000000000000000000000000000a1");
  const runId = await seedReservedRun("refund-session", reservation, 1);
  assert.equal(await settleFailed(runId), "settled");
  assert.deepEqual(await runSettlement(plane.database, runId), {
    status: "failed", failure_reason: "provider_failed", input_tokens: 0, output_tokens: 0,
    cost_usd: "0.000000", finished_ms: String(AT.getTime()), settled_ms: null,
    refunded_ms: String(AT.getTime()),
  });
  assert.equal(await reservedOn(plane.database, reservation), 0);
});

void test("settling the same failure twice gives one message back", async () => {
  const reservation = makeReservation("anon_000000000000000000000000000000a2");
  const runId = await seedReservedRun("twice-refund-session", reservation, 2);
  await settleFailed(runId);
  assert.equal(await settleFailed(runId), "already_settled");
  assert.equal(await reservedOn(plane.database, reservation), 1);
});

void test("a run already marked refunded gives nothing back a second time", async () => {
  const reservation = makeReservation("anon_000000000000000000000000000000a3");
  const marked = { quotaRefundedAt: "2026-09-08T08:00:00.000Z" };
  const runId = await seedReservedRun("marked-refund-session", reservation, 3, marked);
  assert.equal(await settleFailed(runId), "settled");
  assert.equal((await runSettlement(plane.database, runId)).status, "failed");
  assert.equal(await reservedOn(plane.database, reservation), 3);
});

void test("a refund never drives the counter below zero", async () => {
  const reservation = makeReservation("anon_000000000000000000000000000000a4");
  const runId = await seedReservedRun("empty-counter-session", reservation, 0);
  assert.equal(await settleFailed(runId), "settled");
  assert.equal(await reservedOn(plane.database, reservation), 0);
});

void test("a turn that reserved nothing refunds nothing", async () => {
  const runId = await seedRun(plane.database, makeRunningRun("member-session", { payer: "user" }));
  assert.equal(await settleFailed(runId), "settled");
  assert.deepEqual(await runSettlement(plane.database, runId), {
    status: "failed", failure_reason: "provider_failed", input_tokens: 0, output_tokens: 0,
    cost_usd: "0.000000", finished_ms: String(AT.getTime()), settled_ms: null, refunded_ms: null,
  });
});

void test("a turn that ends after UTC midnight refunds the day it charged", async () => {
  const identityId = "anon_000000000000000000000000000000a5";
  const charged = makeReservation(identityId);
  const nextDay = makeReservation(identityId, "2026-09-09");
  const runId = await seedReservedRun("midnight-session", charged, 1);
  await seedReservedMessages(plane.database, nextDay, 4);
  assert.equal(await settleFailed(runId, new Date("2026-09-09T00:05:00.000Z")), "settled");
  assert.equal(await reservedOn(plane.database, charged), 0);
  assert.equal(await reservedOn(plane.database, nextDay), 4);
});

void test("a failed turn banks no usage on its payer's day row", async () => {
  const reservation = makeReservation("anon_000000000000000000000000000000a6");
  const runId = await seedReservedRun("no-usage-session", reservation, 1);
  assert.equal(await settleFailed(runId), "settled");
  assert.deepEqual(await bankedUsage(plane.database, "anon", RESERVED_DAY), {
    requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: "0.000000",
  });
});
