import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";

// #284 Task 5 / #479 P1 review follow-up (Fable): T5-AC5 — "an
// unauthenticated POST /v1/byok/probe is rejected with 401 at the edge, and
// no handler runs" — had ZERO test coverage. Every existing case
// in byok.test.ts is already authenticated; none of them exercise the
// unauthenticated path this AC is actually about. `/v1/byok/probe` is not
// anonymous (the tier's `ANONYMOUS_TIER_KINDS` excludes `probe`), so an
// unauthenticated caller falls straight to the generic 401. The container the
// original wording named as the handler that must not run is deleted (#1605);
// the native tier double is the only receiver left, and it must stay empty too.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

const PROBE = { method: "POST", headers: { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-fake" } };

void test("an unauthenticated POST /v1/byok/probe is rejected with 401 and reaches no receiver", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    agentTurns: nativeAgentReceiver(calls),
  });
  const res = await app.request("/v1/byok/probe", PROBE, { EDGE_SHOWCASE_MODE: "false" }, stubCtx);
  assert.equal(res.status, 401);
  assert.deepEqual(calls, [], "no receiver may run for an unauthenticated probe");
});

void test("an unauthenticated POST /v1/byok/probe is 401 even with anonymous access enabled", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    agentTurns: nativeAgentReceiver(calls),
  });
  const env = {
    EDGE_SHOWCASE_MODE: "false", ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000", TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
  };
  const res = await app.request("/v1/byok/probe", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 401, "the probe is outside the anonymous tier's kinds — enabling anonymous access must not admit it");
  assert.deepEqual(calls, []);
});
