import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";

/** /v1/photo-search edge routing (issue #260 / PR #445 review P1-1):
 * the endpoints must ride the same auth-or-anon gate as /v1/chat — before
 * this wiring they fell through to authenticate() and 401'd for everyone. */

const SECRET = "fixed-test-hmac-key-0000000000000000";
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const stubNext = { fetch: () => Promise.resolve(new Response("next", { status: 200 })) };
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

/** #260's subject is identity + header hygiene on the photo routes, not the
 * #447 Turnstile gate — `turnstileArm.test.ts` owns the challenge behaviour. */
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function envWith(captured: { requests: Request[] }, anonEnabled: boolean) {
  return {
    ...(anonEnabled
      ? {
          ANON_ACCESS_ENABLED: "true",
          ANON_ID_SECRET: SECRET,
          TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
        }
      : {}),
    EDGE_GUARD: fakeGuard(),
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (r: Request) => { captured.requests.push(r); return Promise.resolve(new Response("container")); },
      }),
    },
  } as never;
}

void test("authed /v1/photo-search forwards with worker identity, byok stripped, session kept", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ nextHandler: stubNext, authenticate, turnstileGate: passingGate });
  const cap = { requests: [] as Request[] };
  const headers = {
    Authorization: "Bearer jwt",
    "x-byok-endpoint": "client-set",
    "x-session-id": "sess-1",
    "X-User-Id": "forged",
  };
  const res = await app.request("/v1/photo-search", { method: "POST", headers }, envWith(cap, false), stubCtx);
  assert.equal(await res.text(), "container");
  const forwarded = cap.requests[0];
  assert.ok(forwarded);
  assert.equal(forwarded.headers.get("X-User-Id"), "u1");
  assert.equal(forwarded.headers.get("X-User-Type"), "human");
  assert.equal(forwarded.headers.get("Authorization"), null);
  assert.equal(forwarded.headers.get("x-byok-endpoint"), null);
  assert.equal(forwarded.headers.get("x-session-id"), "sess-1");
});

void test("unauthenticated /v1/photo-search with anon disabled -> 401, container not hit", async () => {
  const app = createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve({ ok: false }),
    turnstileGate: passingGate,
  });
  const cap = { requests: [] as Request[] };
  const res = await app.request("/v1/photo-search", { method: "POST" }, envWith(cap, false), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.requests.length, 0);
});

void test("unauthenticated /v1/photo-search with anon enabled -> minted anonymous identity", async () => {
  const app = createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve({ ok: false }),
    turnstileGate: passingGate,
  });
  const cap = { requests: [] as Request[] };
  const res = await app.request("/v1/photo-search", { method: "POST" }, envWith(cap, true), stubCtx);
  assert.equal(await res.text(), "container");
  const forwarded = cap.requests[0];
  assert.ok(forwarded);
  assert.equal(forwarded.headers.get("X-User-Type"), "anonymous");
  assert.ok(forwarded.headers.get("X-User-Id"));
});

void test("/v1/photo-search/confirm rides the same gate (401 when anon disabled)", async () => {
  const app = createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve({ ok: false }),
    turnstileGate: passingGate,
  });
  const cap = { requests: [] as Request[] };
  const res = await app.request("/v1/photo-search/confirm", { method: "POST" }, envWith(cap, false), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.requests.length, 0);
});

void test("/v1/photo-search/confirm forwards for an authed caller", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ nextHandler: stubNext, authenticate, turnstileGate: passingGate });
  const cap = { requests: [] as Request[] };
  const res = await app.request("/v1/photo-search/confirm", { method: "POST" }, envWith(cap, false), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(cap.requests[0]?.headers.get("X-User-Id"), "u1");
});

void test("x-byok-endpoint is stripped on the anonymous path too", async () => {
  const app = createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve({ ok: false }),
    turnstileGate: passingGate,
  });
  const cap = { requests: [] as Request[] };
  await app.request(
    "/v1/photo-search",
    { method: "POST", headers: { "x-byok-endpoint": "client-set" } },
    envWith(cap, true),
    stubCtx,
  );
  assert.equal(cap.requests[0]?.headers.get("x-byok-endpoint"), null);
});
