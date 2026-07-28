import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";
import { TURNSTILE_HEADER, type TurnstileGate, type TurnstileResult } from "./turnstile.ts";

/**
 * Issue #447: the S1.9 gate (#436) is ARMED on the anonymous branch.
 *
 * `worker/turnstile.test.ts` pins the gate in isolation; this file pins the
 * composition — that an anonymous `/v1/chat` really is challenged, in the right
 * order relative to the 401 path, the rate limiter and the container.
 */

const SECRET = "fixed-test-hmac-key-0000000000000000";
const TURNSTILE_SECRET = "fixed-test-turnstile-secret-0000000";
const ANON_ENV = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET, TURNSTILE_SECRET };
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const stubNext = { fetch: () => Promise.resolve(new Response("next", { status: 200 })) };
const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

interface GateCall {
  readonly token: string | null;
  readonly clientIp: string;
  readonly secret: string;
}

/** A gate that records every check and passes only the token it was told to. */
function recordingGate(calls: GateCall[], solved: string | null): TurnstileGate {
  return {
    check: (token, clientIp, secret): Promise<TurnstileResult> => {
      calls.push({ token, clientIp, secret });
      const ok = solved !== null && token === solved;
      return Promise.resolve({ ok, errorCodes: ok ? [] : ["invalid-input-response"] });
    },
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

function anonEnv(captured: { requests: Request[] }, extra: Record<string, string> = {}) {
  return {
    ...ANON_ENV,
    ...extra,
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

function armedApp(gate: TurnstileGate, authenticated = false) {
  const auth = authenticated
    ? () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const)
    : () => Promise.resolve({ ok: false, reason: "absent" } as const);
  return createWorkerApp({ nextHandler: stubNext, authenticate: auth, turnstileGate: gate });
}

function chat(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

const SOLVED = "solved-token";
const solvedHeaders = { [TURNSTILE_HEADER]: SOLVED, "CF-Connecting-IP": "203.0.113.7" };

void test("a solved anonymous /v1/chat still reaches the container", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/chat", chat(solvedHeaders), anonEnv(captured), stubCtx,
  );
  assert.equal(await res.text(), "container");
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "anonymous");
});

void test("the gate is handed the widget token, the client IP and the secret binding", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/chat", chat(solvedHeaders), anonEnv(captured), stubCtx,
  );
  assert.deepEqual(calls, [{ token: SOLVED, clientIp: "203.0.113.7", secret: TURNSTILE_SECRET }]);
});

void test("an anonymous turn with no token is challenged and never reaches the container", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/chat", chat(), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 403);
  assert.equal(captured.requests.length, 0);
  assert.equal(calls[0]?.token, null);
});

void test("a rejected challenge answers the retryable turnstile envelope", async () => {
  const captured = { requests: [] as Request[] };
  const res = await armedApp(recordingGate([], SOLVED)).request(
    "/v1/chat", chat({ [TURNSTILE_HEADER]: "forged" }), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "turnstile_required");
  assert.equal(body.error.retryable, true);
  assert.equal(captured.requests.length, 0);
});

void test("a challenged turn does not mint an anonymous identity cookie", async () => {
  const captured = { requests: [] as Request[] };
  const res = await armedApp(recordingGate([], SOLVED)).request(
    "/v1/chat", chat(), anonEnv(captured), stubCtx,
  );
  assert.equal(res.headers.get("Set-Cookie"), null);
});

/** A known identity is needed here: an unsolved turn mints no cookie, so two
 * anonymous strangers never share a bucket in the first place. The budget only
 * observably leaks when a returning visitor's own cookie is charged for a
 * challenge they were forced to answer. */
void test("a challenged turn does not spend the identity's burst budget", async () => {
  const captured = { requests: [] as Request[] };
  const env = anonEnv(captured, { ANON_RATE_LIMIT: "2" });
  const app = armedApp(recordingGate([], SOLVED));
  const first = await app.request("/v1/chat", chat(solvedHeaders), env, stubCtx);
  const cookie = String(first.headers.get("Set-Cookie")).split(";")[0] ?? "";
  const withCookie = (extra: Record<string, string>) => chat({ Cookie: cookie, ...extra });
  const challenged = await app.request("/v1/chat", withCookie({}), env, stubCtx);
  assert.equal(challenged.status, 403);
  const res = await app.request("/v1/chat", withCookie(solvedHeaders), env, stubCtx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "container");
});

void test("an authenticated caller is never challenged", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED), true).request(
    "/v1/chat", chat({ Authorization: "Bearer jwt" }), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "human");
});

void test("with anonymous access disabled the answer stays 401, not a challenge", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const env = { ...(anonEnv(captured) as object), ANON_ACCESS_ENABLED: "false" } as never;
  const res = await armedApp(recordingGate(calls, SOLVED)).request("/v1/chat", chat(), env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

void test("a non-allowlisted /v1 path 401s without ever raising a challenge", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/feedback", chat(), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

/** #445 put the photo routes on the anonymous allowlist, so the gate must
 * cover them too — they cost a vision call, the most expensive turn there is. */
void test("an anonymous photo upload is challenged like a chat turn", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/photo-search", chat(), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 403);
  assert.equal(captured.requests.length, 0);
  assert.equal(calls[0]?.token, null);
});

void test("a solved anonymous photo upload reaches the container", async () => {
  const captured = { requests: [] as Request[] };
  const res = await armedApp(recordingGate([], SOLVED)).request(
    "/v1/photo-search", chat(solvedHeaders), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 200);
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "anonymous");
});

void test("the confirm ping is challenged on the anonymous path too", async () => {
  const captured = { requests: [] as Request[] };
  const res = await armedApp(recordingGate([], SOLVED)).request(
    "/v1/photo-search/confirm", chat(), anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 403);
  assert.equal(captured.requests.length, 0);
});

void test("a public /v1 path is not challenged either", async () => {
  const captured = { requests: [] as Request[] };
  const calls: GateCall[] = [];
  const res = await armedApp(recordingGate(calls, SOLVED)).request(
    "/v1/search/preview", { method: "GET" }, anonEnv(captured), stubCtx,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
