import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { ANON_ID_PREFIX, anonymousEnabled, resolveAnonymous } from "./auth.ts";
import { ANON_BUDGET_EXHAUSTED_CODE } from "./costBreaker.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON_ENV = {
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: SECRET,
  TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
};
const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);

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

function anonEnv(captured: { requests: Request[] }, container: () => Response, guard = fakeGuard()) {
  return {
    ...ANON_ENV,
    EDGE_GUARD: guard,
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (r: Request) => { captured.requests.push(r); return Promise.resolve(container()); },
      }),
    },
  } as never;
}

/** These tests are about the anonymous branch itself, so the Turnstile gate
 * (armed in #447) is stubbed to a pass. `turnstileArm.test.ts` owns the
 * challenge behaviour. */
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function anonApp() {
  return createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" }),
    turnstileGate: passingGate,
  });
}

function chat(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

// ── the /v1 gate ───────────────────────────────────────────────────────────

void test("an anonymous /v1/chat reaches the container marked anonymous", async () => {
  const captured = { requests: [] as Request[] };
  const res = await anonApp().request(
    "/v1/chat", chat(), anonEnv(captured, () => new Response("container")), stubCtx,
  );
  assert.equal(await res.text(), "container");
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "anonymous");
  assert.match(String(captured.requests[0]?.headers.get("X-User-Id")), /^anon_[0-9a-f]{32}$/);
});

void test("the anonymous branch sets the identity cookie on the response", async () => {
  const captured = { requests: [] as Request[] };
  const res = await anonApp().request(
    "/v1/chat", chat(), anonEnv(captured, () => new Response("container")), stubCtx,
  );
  assert.match(String(res.headers.get("Set-Cookie")), /^aid=/);
});

void test("a client-forged X-User-Id cannot survive the anonymous branch", async () => {
  const captured = { requests: [] as Request[] };
  await anonApp().request(
    "/v1/chat", chat({ "X-User-Id": "forged", "X-User-Type": "human" }),
    anonEnv(captured, () => new Response("container")), stubCtx,
  );
  assert.notEqual(captured.requests[0]?.headers.get("X-User-Id"), "forged");
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "anonymous");
});

void test("non-allowlisted /v1 paths still 401 for anonymous callers", async () => {
  const captured = { requests: [] as Request[] };
  const res = await anonApp().request(
    "/v1/feedback", chat(), anonEnv(captured, () => new Response("container")), stubCtx,
  );
  assert.equal(res.status, 401);
  assert.equal(captured.requests.length, 0);
});

void test("with anonymous access disabled /v1/chat keeps its 401", async () => {
  const captured = { requests: [] as Request[] };
  const env = { ...(anonEnv(captured, () => new Response("container")) as object), ANON_ACCESS_ENABLED: "false" };
  const res = await anonApp().request("/v1/chat", chat(), env as never, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(captured.requests.length, 0);
});

void test("exceeding the burst limit returns a friendly 429, not a bare status", async () => {
  const captured = { requests: [] as Request[] };
  const env = { ...(anonEnv(captured, () => new Response("container")) as object), ANON_RATE_LIMIT: "1" };
  const cookie = String(
    (await anonApp().request("/v1/chat", chat(), env as never, stubCtx)).headers.get("Set-Cookie"),
  ).split(";")[0] ?? "";
  const res = await anonApp().request("/v1/chat", chat({ Cookie: cookie }), env as never, stubCtx);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "rate_limited");
  assert.match(body.error.message, /少し待ってね/);
});

void test("a separate anonymous identity is not affected by another's burst limit", async () => {
  const captured = { requests: [] as Request[] };
  const env = { ...(anonEnv(captured, () => new Response("container")) as object), ANON_RATE_LIMIT: "1" };
  const cookie = String(
    (await anonApp().request("/v1/chat", chat(), env as never, stubCtx)).headers.get("Set-Cookie"),
  ).split(";")[0] ?? "";
  await anonApp().request("/v1/chat", chat({ Cookie: cookie }), env as never, stubCtx);
  const other = await anonApp().request("/v1/chat", chat(), env as never, stubCtx);
  assert.equal(other.status, 200);
});

// ── the daily-budget circuit breaker (X4) ──────────────────────────────────

const breakerTripped = () =>
  new Response(JSON.stringify({ error: { code: ANON_BUDGET_EXHAUSTED_CODE } }), { status: 403 });

void test("the container's breaker verdict becomes login guidance at the edge", async () => {
  const captured = { requests: [] as Request[] };
  const res = await anonApp().request("/v1/chat", chat(), anonEnv(captured, breakerTripped), stubCtx);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string; action: string } };
  assert.equal(body.error.code, ANON_BUDGET_EXHAUSTED_CODE);
  assert.equal(body.error.action, "login");
});

void test("once tripped the edge short-circuits without hitting the container again", async () => {
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured, breakerTripped, fakeGuard());
  await anonApp().request("/v1/chat", chat(), env, stubCtx);
  const res = await anonApp().request("/v1/chat", chat(), env, stubCtx);
  assert.equal(res.status, 403);
  assert.equal(captured.requests.length, 1);
});

void test("the breaker does not touch logged-in callers", async () => {
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured, breakerTripped, fakeGuard());
  await anonApp().request("/v1/chat", chat(), env, stubCtx);
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
  });
  const res = await app.request("/v1/chat", chat({ Authorization: "Bearer jwt" }), env, stubCtx);
  assert.equal(res.status, 403);
  assert.equal(captured.requests[1]?.headers.get("X-User-Type"), "human");
});

// ── streaming is not buffered by the budget guard ───────────────────────────
// `/v1/chat` answers with an SSE StreamingResponse. Reading a clone of it waits
// for the container to finish the entire turn, so the budget guard must decide
// on the status alone before it ever touches the body. This test pins that: the
// container's stream stays open, and the worker must still hand back a response.
// Passing `await response.clone().text()` as an argument (evaluated eagerly on
// every response, 200s included) hangs here forever.
void test("a still-open container stream is returned without being drained", async () => {
  const captured = { requests: [] as Request[] };
  let release: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      release = () => { controller.close(); };
    },
  });
  const container = () =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

  const response = await Promise.race([
    anonApp().fetch(
      new Request("https://animichi.test/v1/chat", chat()),
      anonEnv(captured, container),
      stubCtx,
    ),
    new Promise<"drained">((resolve) => { setTimeout(() => { resolve("drained"); }, 1_000); }),
  ]);

  assert.notEqual(response, "drained", "the guard drained the stream instead of checking status");
  assert.equal((response as Response).status, 200);
  release?.();
});
