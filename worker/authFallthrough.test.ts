// Issue #441: a presented-but-unverifiable credential must 401, never silently
// become an anonymous identity. Covers both halves of the contract: the reason
// `authenticate` reports, and the branch `createWorkerApp` takes on it.
import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { authenticate, type AuthResult } from "./auth.ts";
import { createWorkerApp } from "./app.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore, type GuardStore } from "./guardStore.ts";

const ENV = { SUPABASE_URL: "https://sb-441.example.test", SUPABASE_SERVICE_ROLE_KEY: "service" };
const SECRET = "fixed-test-hmac-key-0000000000000000";
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const stubNext = { fetch: () => Promise.resolve(new Response("next", { status: 200 })) };
const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function requestedUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (input: RequestInfo | URL) => Promise.resolve(handler(requestedUrl(input)));
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

async function esFixture(host: string, exp: string | number = "1h") {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fake-es-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(`${host}/auth/v1`).setAudience("authenticated").setSubject("fake-user")
    .setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, token };
}

function jwks(jwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
}

// ── `authenticate` reports WHY it failed ───────────────────────────────────

void test("an absent Authorization header reports reason absent", async () => {
  const request = new Request("https://app.example.test/v1/chat");
  const result = await authenticate(request, ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("a non-Bearer Authorization scheme reports reason absent", async () => {
  const request = new Request("https://app.example.test/v1/chat", { headers: { Authorization: "Basic dXNlcjpwdw==" } });
  const result = await authenticate(request, ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("an expired bearer JWT reports reason invalid", async () => {
  const host = "https://sb-441-expired.example.test";
  const { jwk, token } = await esFixture(host, Math.floor(Date.now() / 1000) - 60);
  const result = await authenticate(bearer(token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(jwk)));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a bearer JWT signed by an untrusted key reports reason invalid", async () => {
  const host = "https://sb-441-signature.example.test";
  const trusted = await esFixture(host);
  const untrusted = await esFixture(host);
  const result = await authenticate(bearer(untrusted.token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(trusted.jwk)));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a malformed bearer token reports reason invalid", async () => {
  const result = await authenticate(bearer("not-a-jwt"), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a bearer scheme with no token reports reason absent", async () => {
  // Header values are trimmed before we see them, so `Bearer` + whitespace is
  // the same string as a bare scheme: nothing was actually presented.
  const result = await authenticate(bearer("   "), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("an unknown sk_ api key reports reason invalid", async () => {
  const result = await authenticate(bearer("sk_fake_unknown"), ENV, stubFetch((url) =>
    url.includes("/rest/v1/api_keys") ? new Response("[]", { status: 200 }) : new Response("", { status: 200 })));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

// ── the /v1 branch honours the reason ──────────────────────────────────────

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
    ANON_ACCESS_ENABLED: "true",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    ANON_ID_SECRET: SECRET,
    EDGE_GUARD: fakeGuard(),
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (request: Request) => {
          captured.requests.push(request);
          return Promise.resolve(new Response("container"));
        },
      }),
    },
  } as never;
}

/** #441 is about which credential verdict may become anonymous, so the #447
 * Turnstile gate is stubbed to a pass here; `turnstileArm.test.ts` owns it. */
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function appWith(result: AuthResult) {
  return createWorkerApp({
    nextHandler: stubNext,
    authenticate: () => Promise.resolve(result),
    turnstileGate: passingGate,
  });
}

void test("an invalid credential 401s instead of becoming anonymous", async () => {
  const captured = { requests: [] as Request[] };
  const response = await appWith({ ok: false, reason: "invalid" }).request(
    "/v1/chat", { method: "POST" }, anonEnv(captured), stubCtx,
  );
  assert.equal(response.status, 401);
  assert.equal(captured.requests.length, 0);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

void test("an invalid credential 401 carries the typed unauthorized code", async () => {
  const captured = { requests: [] as Request[] };
  const response = await appWith({ ok: false, reason: "invalid" }).request(
    "/v1/chat", { method: "POST" }, anonEnv(captured), stubCtx,
  );
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "unauthorized");
});

void test("an invalid credential is recorded so a 401 storm is visible", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { warnings.push(String(line)); };
  try {
    await appWith({ ok: false, reason: "invalid" }).request(
      "/v1/chat", { method: "POST" }, anonEnv({ requests: [] }), stubCtx,
    );
  } finally {
    console.warn = original;
  }
  const record = JSON.parse(String(warnings[0])) as { event: string; path: string };
  assert.deepEqual(record, { event: "edge_auth_invalid_credential", path: "/v1/chat" });
});

void test("an absent credential still reaches the container as anonymous", async () => {
  const captured = { requests: [] as Request[] };
  const response = await appWith({ ok: false, reason: "absent" }).request(
    "/v1/chat", { method: "POST" }, anonEnv(captured), stubCtx,
  );
  assert.equal(response.status, 200);
  assert.equal(captured.requests[0]?.headers.get("X-User-Type"), "anonymous");
});
