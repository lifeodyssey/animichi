/**
 * W1-7 (#1256) against real PostgreSQL: the anonymous daily-message CEILING,
 * enforced inside the intake's own transaction.
 *
 * Only a database can answer the question this lane asks. The refusal is a
 * ROLLBACK — the message, the run and the reservation the turn had already
 * written must all be gone — and the counter it compared against is the value
 * the reservation upsert itself returned, under that row's lock. A double would
 * prove neither.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { acceptTurn, type TurnIntake, type TurnRecords } from "../src/agent/intake/turn-intake.ts";
import { QuotaExhaustedError } from "../src/agent/intake/anonymous-message-allowance.ts";
import { NeonTurnRecords } from "../src/agent/intake/neon-turn-records.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { countRows, makeSubmission, reservedCount } from "./agent-rows.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const ALLOWANCE = 2;

function makeIntake(records: TurnRecords): TurnIntake {
  return {
    backstop: { ensureScheduled: () => Promise.resolve() },
    records,
    wakeup: { arm: () => Promise.resolve() },
  };
}

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

/** One turn per call, each on its own conversation so the session's single
 * `running` slot never decides what the quota is supposed to decide. */
async function spendOneMessage(identityId: string, nth: number, allowance = ALLOWANCE): Promise<void> {
  const records = new NeonTurnRecords(plane.transactions, allowance);
  const submission = makeSubmission({
    sessionId: `${identityId}-${String(nth)}`,
    identityId,
    clientMessageId: `cmid-${String(nth)}`,
  });
  await acceptTurn(makeIntake(records), submission, () => NOW);
}

void test("every turn up to the allowance is admitted and reserves one message", async () => {
  const identityId = "anon_00000000000000000000000000000010";
  await spendOneMessage(identityId, 1);
  await spendOneMessage(identityId, 2);
  assert.equal(await reservedCount(plane.database, identityId), ALLOWANCE);
});

void test("the turn past the allowance is refused, and names when the allowance returns", async () => {
  const identityId = "anon_00000000000000000000000000000011";
  await spendOneMessage(identityId, 1);
  await spendOneMessage(identityId, 2);
  await assert.rejects(
    spendOneMessage(identityId, 3),
    (error: unknown) => error instanceof QuotaExhaustedError && error.resetsAt === "2026-09-03T00:00:00Z",
  );
});

void test("the refused turn rolled back its run, its message and its own reservation", async () => {
  const identityId = "anon_00000000000000000000000000000012";
  await spendOneMessage(identityId, 1);
  await spendOneMessage(identityId, 2);
  const runsBefore = await countRows(plane.database, "runs");
  const messagesBefore = await countRows(plane.database, "messages");
  await assert.rejects(spendOneMessage(identityId, 3), (error: unknown) => error instanceof QuotaExhaustedError);
  assert.equal(await countRows(plane.database, "runs"), runsBefore);
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
  assert.equal(await reservedCount(plane.database, identityId), ALLOWANCE);
});

void test("an allowance of 0 disables the ceiling entirely", async () => {
  const identityId = "anon_00000000000000000000000000000013";
  await spendOneMessage(identityId, 1, 0);
  await spendOneMessage(identityId, 2, 0);
  await spendOneMessage(identityId, 3, 0);
  assert.equal(await reservedCount(plane.database, identityId), 3);
});

void test("a signed-in identity is held to no daily message allowance", async () => {
  const records = new NeonTurnRecords(plane.transactions, ALLOWANCE);
  const submission = makeSubmission({
    sessionId: "member-session",
    identityId: "neon-subject-1",
    payer: "user",
    clientMessageId: "cmid-member",
  });
  const receipt = await acceptTurn(makeIntake(records), submission, () => NOW);
  assert.equal(receipt.replayed, false);
  assert.equal(await reservedCount(plane.database, "neon-subject-1"), 0);
});
