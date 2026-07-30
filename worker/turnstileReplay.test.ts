import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";
import { TURNSTILE_HEADER, createTurnstileGate } from "./turnstile.ts";

/**
 * Issue #447 review, P1-1: the armed path exercised with the REAL gate (only
 * the siteverify network call is stubbed), against Cloudflare's actual
 * single-use token semantics — a replayed token answers `timeout-or-duplicate`.
 *
 * This is the attack the card exists to close: drop the `aid` cookie, get a
 * fresh identity and a fresh rate-limit bucket, and replay one solved token.
 */

const ANON_ENV = {
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
  TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
};
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const SOLVED = "solved-token";

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

/** Cloudflare's real contract: a token verifies once, then is a duplicate. */
function singleUseSiteverify(calls: string[]): typeof fetch {
  const spent = new Set<string>();
  return (_input, init) => {
    const rawBody = init?.body;
    const bodyText = rawBody instanceof URLSearchParams ? rawBody.toString() : typeof rawBody === "string" ? rawBody : "";
    const token = new URLSearchParams(bodyText).get("response") ?? "";
    calls.push(token);
    const fresh = !spent.has(token);
    spent.add(token);
    const body = fresh ? { success: true } : { success: false, "error-codes": ["timeout-or-duplicate"] };
    return Promise.resolve(Response.json(body));
  };
}

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

function anonEnv(captured: { requests: Request[] }) {
  return {
    ...ANON_ENV,
    EDGE_GUARD: fakeGuard(),
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (r: Request) => {
          captured.requests.push(r);
          return Promise.resolve(new Response("container"));
        },
      }),
    },
  } as never;
}

/** The real gate, wired exactly as `createWorkerApp` builds its default. */
function realGateApp(calls: string[]) {
  return createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    turnstileGate: createTurnstileGate({ fetchImpl: singleUseSiteverify(calls) }),
  });
}

function chat(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

const solved = { [TURNSTILE_HEADER]: SOLVED, "CF-Connecting-IP": "203.0.113.7" };

void test("a genuinely solved token verifies once and the turn is forwarded", async () => {
  const calls: string[] = [];
  const captured = { requests: [] as Request[] };
  const res = await realGateApp(calls).request("/v1/chat", chat(solved), anonEnv(captured), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [SOLVED]);
  assert.equal(captured.requests.length, 1);
});

void test("the same visitor's follow-up turn rides the window without re-verifying", async () => {
  const calls: string[] = [];
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured);
  const app = realGateApp(calls);
  const first = await app.request("/v1/chat", chat(solved), env, stubCtx);
  const cookie = String(first.headers.get("Set-Cookie")).split(";")[0] ?? "";
  const second = await app.request("/v1/chat", chat({ ...solved, Cookie: cookie }), env, stubCtx);
  assert.equal(second.status, 200);
  assert.deepEqual(calls, [SOLVED]);
  assert.equal(captured.requests.length, 2);
});

void test("replaying the token from a dropped cookie is rejected, not waved through", async () => {
  const calls: string[] = [];
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured);
  const app = realGateApp(calls);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  const replay = await app.request("/v1/chat", chat(solved), env, stubCtx);
  assert.equal(replay.status, 403);
  assert.deepEqual(calls, [SOLVED, SOLVED], "the replay must reach siteverify, not the local window");
  assert.equal(captured.requests.length, 1);
});

void test("the cookie-drop replay stays rejected however often it is retried", async () => {
  const calls: string[] = [];
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured);
  const app = realGateApp(calls);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  const third = await app.request("/v1/chat", chat(solved), env, stubCtx);
  assert.equal(third.status, 403);
  assert.equal(captured.requests.length, 1);
});
