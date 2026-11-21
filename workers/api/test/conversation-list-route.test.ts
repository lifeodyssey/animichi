import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";

// The conversation index route (Card E of the #1317 decomposition) at the
// gateway seam. The tier is the only thing that opens the `sessions` database,
// so "the tier was never called" is the evidence that an unauthenticated
// request never reached the database. #1605 deleted the container recorder the
// file used to keep as the opposite direction's witness: the tier double is the
// only receiver left, so an empty call list is now that witness too.

const PATH = "/v1/conversations";
const env = { EDGE_SHOWCASE_MODE: "false" };
const visitorEnv = { EDGE_SHOWCASE_MODE: "false", ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000", TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000" };
const execution = { waitUntil(promise: Promise<unknown>) { void promise; }, passThroughOnException() { return undefined; } } as ExecutionContext;

void test("the verified identity reaches the tier with the list request verbatim", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "owner", userType: "human" }),
    agentTurns: nativeAgentReceiver(calls, () => new Response("tier-list")),
  });
  const response = await app.request(PATH, { headers: { Authorization: "Bearer jwt" } }, env, execution);

  assert.equal(await response.text(), "tier-list");
  assert.deepEqual(calls.map(({ identity, sessionId }) => ({ identity, sessionId })),
    [{ identity: { userId: "owner", userType: "human" }, sessionId: undefined }]);
  assert.equal(calls[0]?.request.method, "GET");
});

void test("an unauthenticated visitor gets a 401 without Turnstile or the tier", async () => {
  const turnstile: string[] = [];
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" }),
    turnstileGate: { check: () => { turnstile.push("check"); return Promise.resolve({ ok: true, errorCodes: [] }); } },
    agentTurns: nativeAgentReceiver(calls),
  });
  const response = await app.request(PATH, {}, visitorEnv, execution);

  assert.equal(response.status, 401, "one account's index is never a visitor's");
  assert.deepEqual([turnstile, calls], [[], []], "no anonymous pipeline, no receiver");
});

void test("an invalid bearer cannot reach the list either", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "invalid" }),
    agentTurns: nativeAgentReceiver(calls),
  });
  const response = await app.request(PATH, { headers: { Authorization: "Bearer bad" } }, env, execution);

  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});
