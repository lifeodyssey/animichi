import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, type Env } from "./app.ts";

// #284 Task 5 / #479 P1 review follow-up (Fable): T5-AC5 — "an
// unauthenticated POST /v1/byok/probe is rejected with 401 at the edge, and
// no container handler runs" — had ZERO test coverage. Every existing case
// in worker/byok.test.ts is already authenticated; none of them exercise the
// unauthenticated path this AC is actually about. `/v1/byok/probe` is not in
// `ANON_V1`, so an unauthenticated caller must fall straight to the generic
// 401, never reaching CONTAINER.fetch.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function env(containerFetch: () => Promise<Response>): { env: Env; callCount: () => number } {
  let calls = 0;
  const wrapped = () => {
    calls += 1;
    return containerFetch();
  };
  const e = {
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: wrapped }) },
  } as unknown as Env;
  return { env: e, callCount: () => calls };
}

void test("an unauthenticated POST /v1/byok/probe is rejected with 401 and never reaches the container", async () => {
  const { env: e, callCount } = env(() => Promise.resolve(new Response("ok", { status: 200 })));
  const app = createWorkerApp({
        authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
  });
  const res = await app.request(
    "/v1/byok/probe",
    { method: "POST", headers: { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-fake" } },
    e,
    stubCtx,
  );
  assert.equal(res.status, 401);
  assert.equal(callCount(), 0, "the container must never be reached for an unauthenticated probe");
});

void test("an unauthenticated POST /v1/byok/probe is 401 even with anonymous access enabled (not in ANON_V1)", async () => {
  const { env: e, callCount } = env(() => Promise.resolve(new Response("ok", { status: 200 })));
  const withAnon = { ...e, ANON_ACCESS_ENABLED: "true" } as unknown as Env;
  const app = createWorkerApp({
        authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
  });
  const res = await app.request("/v1/byok/probe", { method: "POST" }, withAnon, stubCtx);
  assert.equal(res.status, 401, "the probe is absent from ANON_V1 — anonymous access enablement must not admit it");
  assert.equal(callCount(), 0);
});
