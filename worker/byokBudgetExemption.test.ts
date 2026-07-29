import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, type Env } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { latchBudget, utcDayKey } from "./costBreaker.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";

// #284 Task 4 regression lock (edge half): an AUTHENTICATED `/v1/chat`
// request must never consult `budgetLatched` — that check is reachable
// only from `handleAnonymousV1`. This is the property that makes BYOK's
// quota exemption "free" (no new edge code needed): a future refactor that
// moved the breaker onto the shared authenticated path would silently start
// rejecting logged-in (and therefore BYOK) traffic. Proven behaviourally —
// by latching today's budget and asserting an authenticated request still
// succeeds — never by asserting call counts on an internal, since the
// public contract is "the response is unaffected", not "a particular
// function ran".

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const DAY_KEY = utcDayKey(NOW);

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function fakeGuard() {
  const shards = new Map<string, GuardStore>();
  const storeFor = (name: string) => {
    const existing = shards.get(name);
    if (existing) return existing;
    const created = memoryGuardStore();
    shards.set(name, created);
    return created;
  };
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: (request: Request) =>
        handleGuardRequest(request, storeFor(String(id)), NOW, { limit: 20, windowSeconds: 60 }),
    }),
  };
}

function env(guard: ReturnType<typeof fakeGuard>): Env {
  return {
    EDGE_GUARD: guard,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as unknown as Env;
}

void test("an authenticated /v1/chat request succeeds even with today's anonymous budget latched", async () => {
  const guard = fakeGuard();
  await latchBudget(guard, DAY_KEY);

  const app = createWorkerApp({
    nextHandler: { fetch: () => Promise.resolve(new Response("next", { status: 200 })) },
    authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
  const res = await app.request(
    "/v1/chat",
    { method: "POST", headers: { Authorization: "Bearer jwt" } },
    env(guard),
    stubCtx,
  );

  assert.equal(res.status, 200, "the latched anonymous budget must never be consulted for authenticated traffic");
});

void test("an authenticated BYOK request (X-BYOK-* headers present) is likewise unaffected by the latch", async () => {
  const guard = fakeGuard();
  await latchBudget(guard, DAY_KEY);

  const app = createWorkerApp({
    nextHandler: { fetch: () => Promise.resolve(new Response("next", { status: 200 })) },
    authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
  const res = await app.request(
    "/v1/chat",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer jwt",
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": "sk-fake",
      },
    },
    env(guard),
    stubCtx,
  );

  assert.equal(res.status, 200);
});
