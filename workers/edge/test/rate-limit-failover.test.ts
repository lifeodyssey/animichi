import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";

// AC4 (#680): with the limiter unavailable, high-cost/mutation classes FAIL
// CLOSED (a metered turn that cannot run must not run unmetered), while
// cacheable public reads FAIL OPEN and emit an alert so the read surface
// never 500s and the operator still hears about the damper being down.

// A durable guard whose shard fetch fails every time (outage).
function downGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.reject(new Error("limiter down")) }),
  };
}

// A passing durable guard (for public-read tests that must not touch 503).
function allowGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))) }),
  };
}

function authedApp(userId = "u1") {
  return createWorkerApp({ authenticate: () => Promise.resolve({ ok: true, userId, userType: "human" } as const) });
}

function usersEnv() {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: downGuard(),
    USERS: { fetch: () => Promise.resolve(new Response("users")) },
  } as never;
}

// ── durable fail-closed on outage (chat, users mutation) ────────────────

void test("a chat turn FAILS CLOSED (503) when the durable limiter is down", async () => {
  const app = authedApp();
  const env = { EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: downGuard(), CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) } } as never;
  const res = await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, env, stubCtx);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limit_unavailable");
});

void test("a BYOK probe FAILS CLOSED (503) when the durable limiter is down", async () => {
  const app = authedApp();
  const env = { EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: downGuard(), CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) } } as never;
  const res = await app.request("/v1/byok/probe", { method: "POST", headers: { Authorization: "Bearer jwt" } }, env, stubCtx);
  assert.equal(res.status, 503);
});

void test("a users MUTATION FAILS CLOSED (503) when the durable limiter is down", async () => {
  const app = authedApp();
  const res = await app.request("/v1/users/saved-routes", { method: "POST", headers: { Authorization: "Bearer jwt" } }, usersEnv(), stubCtx);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limit_unavailable");
});

void test("a users GET mutation-read still succeeds on a limiter outage", async () => {
  const app = authedApp();
  const res = await app.request("/v1/users/saved-routes", { method: "GET", headers: { Authorization: "Bearer jwt" } }, usersEnv(), stubCtx);
  assert.equal(res.status, 200);
});

// ── cacheable public reads FAIL OPEN + alert on a native damper outage ───

function nativeEnv(binding: unknown) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: allowGuard(),
    RATE_LIMITER: binding,
    CATALOG: { fetch: () => Promise.resolve(new Response("cat")) },
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as never;
}

function captureWarns(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { calls.push(args.map(String).join(" ")); };
  return { calls, restore: () => { console.warn = original; } };
}

void test("a cacheable public read FAILS OPEN and ALERTS when the native damper throws", async () => {
  const w = captureWarns();
  try {
    const binding = { limit: () => Promise.reject(new Error("binding down")) };
    const app = createWorkerApp({});
    const res = await app.request("/catalog/public/anime-overview/123", {}, nativeEnv(binding), stubCtx);
    assert.equal(res.status, 200, "a cacheable read must fail open, not 500");
    assert.ok(w.calls.some((c) => c.includes("edge_native_rate_limit_alert")), "the fail-open outage must emit an alert");
  } finally {
    w.restore();
  }
});

void test("a denied native damper on a public read returns a typed 429", async () => {
  const binding = { limit: () => Promise.resolve({ success: false }) };
  const app = createWorkerApp({});
  const res = await app.request("/v1/search/preview?q=test", {}, nativeEnv(binding), stubCtx);
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
});

void test("a public v1 guide read with no damper binding still succeeds (fail open)", async () => {
  const app = createWorkerApp({});
  const env = { EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: allowGuard(), CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) } } as never;
  const res = await app.request("/v1/bangumi/485/guide", {}, env, stubCtx);
  assert.equal(res.status, 200);
});
