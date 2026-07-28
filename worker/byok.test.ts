import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";

// Task 9 (#284): per-identity rate limiting on the authenticated /v1/* path.
// `checkRateLimit` previously ran only from the anonymous branch
// (`handleAnonymousV1`) — an authenticated caller had no request-rate ceiling
// at all. BYOK makes that unbounded: a authed request can drive an outbound
// call to a caller-chosen `base_url`, and accounts are free self-serve
// magic-link signups, so attribution alone is not a preventive control.

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const stubNext = { fetch: () => Promise.resolve(new Response("next", { status: 200 })) };
const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

/** A guard namespace backed by per-name in-memory shards and a fixed clock. */
function fakeGuard(nowMs = NOW) {
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
        handleGuardRequest(request, storeFor(String(id)), nowMs, { limit: 20, windowSeconds: 60 }),
    }),
  };
}

/** A guard whose shard always 500s — simulates a Durable Object outage. */
function brokenGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.resolve(new Response("down", { status: 500 })) }),
  };
}

function env(guard = fakeGuard(), extra: Record<string, unknown> = {}) {
  return {
    EDGE_GUARD: guard,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
    ...extra,
  } as never;
}

function authedApp(userId = "user-a") {
  return createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve({ ok: true, userId, userType: "human" } as const),
  });
}

function req(path: string, headers: Record<string, string> = {}) {
  return { method: "POST", headers: { Authorization: "Bearer jwt", ...headers } };
}

// ── AC1: happy path + burst → 429 ──────────────────────────────────────────

void test("an authenticated /v1/chat request is counted against a per-identity limit", async () => {
  const e = env(fakeGuard(), { AUTH_RATE_LIMIT: "1" });
  const res = await authedApp().request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 200);
});

void test("a burst beyond the authenticated limit returns 429 with Retry-After", async () => {
  const e = env(fakeGuard(), { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const res = await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
});

// ── AC2: /v1/byok/probe covered by the same limiter ────────────────────────

void test("/v1/byok/probe is subject to the same authenticated-path limiter", async () => {
  const e = env(fakeGuard(), { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  await app.request("/v1/byok/probe", req("/v1/byok/probe"), e, stubCtx);
  const res = await app.request("/v1/byok/probe", req("/v1/byok/probe"), e, stubCtx);
  assert.equal(res.status, 429);
});

void test("/v1/chat and /v1/byok/probe share one identity's window", async () => {
  const e = env(fakeGuard(), { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const res = await app.request("/v1/byok/probe", req("/v1/byok/probe"), e, stubCtx);
  assert.equal(res.status, 429);
});

// ── AC3: identity isolation ─────────────────────────────────────────────────

void test("user A's burst never consumes user B's allowance", async () => {
  const guard = fakeGuard();
  const e = env(guard, { AUTH_RATE_LIMIT: "1" });
  await authedApp("user-a").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const res = await authedApp("user-b").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 200);
});

void test("an anonymous caller's allowance is unaffected by authenticated traffic", async () => {
  const guard = fakeGuard();
  const e = { ...env(guard, { AUTH_RATE_LIMIT: "1", ANON_RATE_LIMIT: "1", ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000" }) };
  await authedApp("user-a").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const anonApp = createWorkerApp({ nextHandler: stubNext, authenticate: () => Promise.resolve({ ok: false } as const) });
  const res = await anonApp.request("/v1/chat", { method: "POST", headers: {} }, e, stubCtx);
  assert.equal(res.status, 200);
});

// ── AC4: fail-open on a guard outage ────────────────────────────────────────

void test("the limiter fails open when the EDGE_GUARD shard is unavailable", async () => {
  const e = env(brokenGuard());
  const res = await authedApp().request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 200);
});

// ── AC5: the key is the identity only, never caller-supplied input ─────────

void test("varying X-BYOK-* headers or base_url never changes whose allowance is spent", async () => {
  const e = env(fakeGuard(), { AUTH_RATE_LIMIT: "1" });
  const app = authedApp("user-a");
  await app.request(
    "/v1/chat",
    req("/v1/chat", { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-forged", "X-BYOK-Base-Url": "https://evil.example" }),
    e, stubCtx,
  );
  const res = await app.request(
    "/v1/chat",
    req("/v1/chat", { "X-BYOK-Provider": "anthropic", "X-BYOK-Key": "different-key" }),
    e, stubCtx,
  );
  assert.equal(res.status, 429, "same identity must still be limited regardless of BYOK headers");
});

void test("an unauthenticated caller cannot spend an authenticated identity's allowance by forging X-BYOK-* headers", async () => {
  const e = { ...env(fakeGuard(), { AUTH_RATE_LIMIT: "1", ANON_ACCESS_ENABLED: "false" }) };
  const anonApp = createWorkerApp({ nextHandler: stubNext, authenticate: () => Promise.resolve({ ok: false } as const) });
  const res = await anonApp.request(
    "/v1/chat",
    { method: "POST", headers: { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-forged" } },
    e, stubCtx,
  );
  assert.equal(res.status, 401);
});
