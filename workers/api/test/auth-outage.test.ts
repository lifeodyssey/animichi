// Issue #452: a JWKS outage and a rejected credential are different failures,
// and collapsing them costs the client real work. A rejected credential is the
// client's own problem — its D8 path clears the token and mints another — but an
// outage cannot be fixed by re-authenticating against the same broken key set,
// so 401ing it starts a refresh loop that lasts exactly as long as the outage.
// These cases pin the third reason `authenticate` reports, the wire outcome it
// earns, and the #448 boundary it must not cross: unverifiable is still not an
// identity.
//
// test-type: unit (no network — the transport is a double; no database).
import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { authenticate } from "../src/identity/auth.ts";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { stubCtx } from "./doubles/entry-env.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const LIVE = "1h";
const OUTAGE = () => new Response("", { status: 500 });

function requestedUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

function stubFetch(serve: (url: string) => Response | Promise<Response>): typeof fetch {
  return (input: RequestInfo | URL) => Promise.resolve(serve(requestedUrl(input)));
}

/** A fresh EdDSA key pair the JWKS publishes under `kid`, and a `mint` for the
 * tokens it signs. Every case uses its own host: `remoteJwks` caches a resolver
 * per URL for the isolate's lifetime, so a shared host would hand the second
 * app the first app's stub. */
async function signingKey(host: string, kid = "fake-outage-key") {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk: JWK = { ...await exportJWK(publicKey), kid };
  const mint = (exp: string | number) => new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuer(host).setAudience(host).setSubject("fake-user").setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, mint };
}

function secondsAgo(seconds: number): number {
  return Math.floor(Date.now() / 1000) - seconds;
}

function jwks(jwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
}

function neonFor(host: string) {
  return { NEON_AUTH_JWKS_URL: `${host}/.well-known/jwks.json` };
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

function appEnv(host: string): never {
  return {
    NEON_AUTH_JWKS_URL: `${host}/.well-known/jwks.json`,
    ANON_ACCESS_ENABLED: "true",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    ANON_ID_SECRET: SECRET,
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: fakeGuard(NOW).namespace,
  } as never;
}

/** The production wiring (`app.ts` resolves `authenticate` exactly this way)
 * with only the JWKS transport stubbed, so a case reads the real wire outcome.
 * The Turnstile gate passes, so nothing but the reason stands between an
 * unverifiable credential and the anonymous pool. */
function appOverJwks(serve: (url: string) => Response | Promise<Response>, calls: NativeAgentCall[] = []) {
  return createWorkerApp({
    authenticate: (request, env, ctx) => authenticate(request, env, stubFetch(serve), ctx),
    turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
    agentTurns: nativeAgentReceiver(calls),
  });
}

function authorized(token: string, method = "POST"): RequestInit {
  return { method, headers: { Authorization: `Bearer ${token}` } };
}

// ── `authenticate` tells an outage apart from a rejection ──────────────────

void test("a JWKS answering 500 reports the credential unverifiable, not invalid", async () => {
  const host = "https://neon-452-status.example.test";
  const { mint } = await signingKey(host);
  const result = await authenticate(bearer(await mint(LIVE)), neonFor(host), stubFetch(OUTAGE));
  assert.deepEqual(result, { ok: false, reason: "unverifiable", detail: "status 500" });
});

void test("a JWKS fetch that times out reports the credential unverifiable", async () => {
  const host = "https://neon-452-timeout.example.test";
  const { mint } = await signingKey(host);
  const timedOut = stubFetch(() => Promise.reject(Object.assign(new Error("slow"), { name: "TimeoutError" })));
  const result = await authenticate(bearer(await mint(LIVE)), neonFor(host), timedOut);
  assert.deepEqual(result, { ok: false, reason: "unverifiable", detail: "TimeoutError" });
});

void test("a JWKS serving no key for the token's kid is a rejection, not an outage", async () => {
  const host = "https://neon-452-kid.example.test";
  const { mint } = await signingKey(host, "the-tokens-key");
  const { jwk } = await signingKey(host, "a-key-published-elsewhere");
  const result = await authenticate(bearer(await mint(LIVE)), neonFor(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

// ── the wire outcome each reason earns ────────────────────────────────────

void test("a JWKS outage answers 503 where a rejected credential answers 401", async () => {
  const outageHost = "https://neon-452-outage.example.test";
  const rejectHost = "https://neon-452-rejected.example.test";
  const outageKey = await signingKey(outageHost);
  const { jwk, mint } = await signingKey(rejectHost);
  const outage = await appOverJwks(OUTAGE)
    .request("/v1/chat", authorized(await outageKey.mint(LIVE)), appEnv(outageHost), stubCtx);
  const rejected = await appOverJwks(() => jwks(jwk))
    .request("/v1/chat", authorized(await mint(secondsAgo(60))), appEnv(rejectHost), stubCtx);
  assert.equal(outage.status, 503, "a JWKS outage must not answer the 401 a rejected credential earns");
  assert.equal(rejected.status, 401, "a rejected credential is still the #441 401");
});

void test("an outage does not tell the client to clear the credential it could not check", async () => {
  const host = "https://neon-452-clear.example.test";
  const { mint } = await signingKey(host);
  const response = await appOverJwks(OUTAGE)
    .request("/v1/chat", authorized(await mint(LIVE)), appEnv(host), stubCtx);
  const body = await response.json() as { error: { code: string } };
  assert.equal(response.status, 503, "the client's D8 path clears and re-mints on a 401, and on nothing else");
  assert.equal(body.error.code, "verification_unavailable");
  assert.equal(response.headers.get("Retry-After"), "30", "the client must be told to back off, not to re-authenticate");
  assert.equal(response.headers.get("WWW-Authenticate"), null, "no Bearer challenge: the credential was never shown to be bad");
});

void test("an unverifiable credential never becomes an anonymous identity", async () => {
  const host = "https://neon-452-not-anonymous.example.test";
  const { mint } = await signingKey(host);
  const captured: NativeAgentCall[] = [];
  const response = await appOverJwks(OUTAGE, captured)
    .request("/v1/chat", authorized(await mint(LIVE)), appEnv(host), stubCtx);
  assert.equal(response.status, 503, "#448: a presented credential must not fall through to the anonymous pool");
  assert.equal(captured.length, 0, "the tier must never see an identity minted from a credential nobody checked");
});

void test("an unverifiable credential is refused at the anonymous entry too", async () => {
  const host = "https://neon-452-entry.example.test";
  const { mint } = await signingKey(host);
  const response = await appOverJwks(OUTAGE)
    .request("/v1/turnstile/verify", authorized(await mint(LIVE)), appEnv(host), stubCtx);
  assert.equal(response.status, 503, "#448: only an absent credential may reach the anonymous entry");
});

void test("an unverifiable credential is refused on the users and adopt routes", async () => {
  const host = "https://neon-452-users.example.test";
  const { mint } = await signingKey(host);
  const users = await appOverJwks(OUTAGE)
    .request("/v1/users/saved-routes", authorized(await mint(LIVE), "GET"), appEnv(host), stubCtx);
  const adopt = await appOverJwks(OUTAGE)
    .request("/v1/sessions/adopt", authorized(await mint(LIVE)), appEnv(host), stubCtx);
  assert.equal(users.status, 503, "a users read must not 401 a credential the edge could not check");
  assert.equal(adopt.status, 503, "adoption must not 401 a credential the edge could not check");
});

void test("an outage is recorded so it is not read as a 401 storm", async () => {
  const host = "https://neon-452-telemetry.example.test";
  const { mint } = await signingKey(host);
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { warnings.push(String(line)); };
  try {
    await appOverJwks(OUTAGE)
      .request("/v1/chat", authorized(await mint(LIVE)), appEnv(host), stubCtx);
  } finally {
    console.warn = original;
  }
  const records = warnings.map((line) => JSON.parse(line) as { event: string });
  const outage = records.find((entry) => entry.event === "edge_auth_verification_unavailable");
  assert.deepEqual(outage, { event: "edge_auth_verification_unavailable", path: "/v1/chat", detail: "status 500" });
  assert.equal(
    records.find((entry) => entry.event === "edge_auth_invalid_credential"), undefined,
    "an outage must not be counted as a rejected credential",
  );
});
