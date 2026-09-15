import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { pool } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";

/** The production budget is 100 s; the lane shortens it so the bound is verified without waiting it out. */
const DEADLINE_MS = 300;
const BOUND_MS = 30_000;

interface AdmittedTurn { operation_id: string; state: string; reason: string | null; refunded: boolean }

async function settlementObserver(context: TestContext) {
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  return { settled: once(observer, "notification", { signal: AbortSignal.any([context.signal, AbortSignal.timeout(BOUND_MS)]) }).then(() => true, () => false) };
}

async function admittedTurn(): Promise<AdmittedTurn[]> {
  const plan = "SELECT operation_id, state, rejection_reason AS reason, quota_refunded_at IS NOT NULL AS refunded FROM agent_admissions WHERE client_message_id = 'first'";
  return (await pool.query<AdmittedTurn>(plan)).rows;
}

async function terminalStatuses(operationId: string): Promise<string[]> {
  const plan = "SELECT value->>'status' AS status FROM pi_scalar_values WHERE namespace='pi.result' AND key=$1";
  return (await pool.query<{ status: string }>(plan, [operationId])).rows.map((row) => row.status);
}

void test("an abandoned client turn settles inside its budget instead of waiting for the provider", { timeout: 90_000 }, async (context) => {
  const { worker } = await businessWorker(context, { TEST_TURN_DEADLINE_MS: String(DEADLINE_MS) });
  const { settled } = await settlementObserver(context);
  const abandoned = await worker.dispatchFetch("https://host.test/abandon", { method: "POST", body: JSON.stringify(submission) });
  assert.equal(abandoned.status, 200, await abandoned.clone().text());
  assert.equal(await settled, true, "The turn must settle with no client left on the watch");
  const admitted = await admittedTurn();
  const turn = admitted[0];
  assert.ok(turn, "The abandoned turn must leave exactly one admission");
  assert.deepEqual({ state: turn.state, reason: turn.reason, refunded: turn.refunded },
    { state: "settled", reason: "deadline_exceeded", refunded: true });
  assert.deepEqual(await terminalStatuses(turn.operation_id), ["aborted"]);
  const requests = await worker.dispatchFetch("https://host.test/provider-report", { method: "POST", body: JSON.stringify(submission) });
  assert.deepEqual(await requests.json(), { requests: 1 }, "The budget boundary must stop the turn before a second model request");
});
