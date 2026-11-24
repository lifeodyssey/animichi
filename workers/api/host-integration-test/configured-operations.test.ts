import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import type { Miniflare } from "miniflare";
import { pool } from "./postgres.ts";
import { chatBody, chatHeaders, defaultWorker } from "./default-worker.ts";
import type { DriveReport } from "./configured-operations.worker.ts";

/**
 * ConfiguredOperations, the deployed host's model operations, as the default SessionAgent runs them: a settled
 * BYOK operation keeps neither its key nor its provider, its live watch redacts the key a provider streams back,
 * and an operation whose preparation is refused without a record is never driven. Model calls reach only the
 * local provider double.
 */

const OBSERVED_HOST = new URL("./configured-operations.worker.ts", import.meta.url);
const MEMBER = { TEST_IDENTITY: "member-native", TEST_USER_TYPE: "user" };
/** An obviously fake caller key, shaped like no provider's key, so only the operation's own scrub can redact it. */
const CALLER_KEY = "caller-echo-key";
const CHAT = "https://host.test/v1/chat";

/** A member's chat turn that brings its own OpenAI-compatible key. */
function byokTurn(key: string) {
  return { method: "POST", body: chatBody, headers: { ...chatHeaders, "x-byok-provider": "openai-compatible",
    "x-byok-base-url": "https://api.openai.com/v1", "x-byok-model": "gpt-4.1", "x-byok-key": key } };
}

/** Resolves true once a settlement commits; the listener is armed before the turn is sent. */
async function settlementCommit(context: TestContext) {
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
  return { settled: once(observer, "notification", { signal }).then(() => true, () => false) };
}

const RESPOND = { index: 0, id: "answer", type: "function", function: { name: "respond", arguments: JSON.stringify({ kind: "greeting", message: "Done" }) } };

/** A provider answer that streams the caller's key back as text, the way model output arrives, then calls respond. */
function echoedKey(key: string) {
  const text = { choices: [{ index: 0, delta: { content: `Your key is ${key}` }, finish_reason: null }] };
  const respond = { choices: [{ index: 0, delta: { tool_calls: [RESPOND] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } };
  const events = [text, respond].map((chunk) => `data: ${JSON.stringify({ id: "echo", object: "chat.completion.chunk", created: 0, model: "gpt-4.1", ...chunk })}\n\n`);
  return new Response(`${events.join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

/** The observed host's drives and its last drive's provider, read once the work it has queued has finished. */
async function driveReport(worker: Miniflare) {
  const response = await worker.dispatchFetch("https://host.test/drive-report", { headers: chatHeaders });
  return await response.json() as DriveReport;
}

void test("settling a BYOK operation logs its key out and removes its provider from the session's models", { timeout: 60_000 }, async (context) => {
  const { worker } = await defaultWorker(context, MEMBER, {}, OBSERVED_HOST);
  const { settled } = await settlementCommit(context);
  const response = await worker.dispatchFetch(CHAT, byokTurn(CALLER_KEY));
  assert.equal(response.status, 200);
  await response.body?.cancel();
  assert.equal(await settled, true);
  const { served } = await driveReport(worker);
  assert.deepEqual(served, { provider: "openai", atDrive: { registered: true, key: CALLER_KEY }, now: { registered: false, key: null } },
    "The drive ran on the caller's provider and key; settlement must log the key out and remove the provider");
});

void test("the live watch of a BYOK operation redacts the caller's key when the provider streams it back", { timeout: 60_000 }, async (context) => {
  const { worker, requests } = await defaultWorker(context, MEMBER, { model: () => echoedKey(CALLER_KEY) });
  const { settled } = await settlementCommit(context);
  const response = await worker.dispatchFetch(CHAT, byokTurn(CALLER_KEY));
  assert.equal(response.status, 200);
  const wire = await response.text();
  assert.equal(await settled, true);
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${CALLER_KEY}`, "The provider is called with the operation's own key");
  assert.match(wire, /Your key is \[redacted\]/, "The provider's streamed text reaches the watch with the key redacted");
  assert.doesNotMatch(wire, /caller-echo-key/);
});

void test("a cold host without the platform key leaves an accepted server-paid operation undriven, accepted and unsettled", { timeout: 60_000 }, async (context) => {
  const resources = await defaultWorker(context, {}, {}, OBSERVED_HOST);
  await pool.query("ALTER TABLE agent_open_operations ADD CONSTRAINT host_test_lost_reply CHECK(false)");
  context.after(async () => { await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT IF EXISTS host_test_lost_reply"); });
  const lost = await resources.worker.dispatchFetch(CHAT, { method: "POST", headers: chatHeaders, body: chatBody });
  assert.equal(lost.status, 500, await lost.text());
  await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT host_test_lost_reply");
  const cold = await resources.restart({ MIMO_API_KEY: "" });
  const woken = await cold.dispatchFetch("https://host.test/wake", { method: "POST", headers: chatHeaders });
  assert.equal(woken.status, 200, await woken.text());
  assert.equal(resources.requests.length, 0);
  assert.equal((await driveReport(cold)).drives, 0, "A refused preparation must not reach the drive");
  const ending = await pool.query("SELECT a.state,a.rejection_reason,a.quota_refunded_at,s.settled_at FROM agent_admissions a JOIN agent_settlements s USING(operation_id)");
  assert.deepEqual(ending.rows, [{ state: "accepted", rejection_reason: null, quota_refunded_at: null, settled_at: null }],
    "Nothing settles, cancels or refunds: the operation stays accepted with its quota reserved");
  assert.deepEqual((await pool.query("SELECT key FROM pi_scalar_values WHERE namespace='pi.result'")).rows, []);
});
