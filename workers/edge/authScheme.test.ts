// Issue #441 (review P1-1): RFC 7235 §2.1 makes the auth-scheme token
// case-insensitive, so `bearer`/`BEARER`/`BeArEr` are the same scheme as
// `Bearer`. A case-sensitive check reports them as `absent` and hands the
// caller a fresh anonymous identity — exactly the silent downgrade #441 closes.
import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { authenticate } from "./auth.ts";

const HOST = "https://sb-441-scheme.example.test";
const ENV = { SUPABASE_URL: HOST, SUPABASE_SERVICE_ROLE_KEY: "service" };

function requestedUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (input: RequestInfo | URL) => Promise.resolve(handler(requestedUrl(input)));
}

function authorized(value: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: value } });
}

async function expiredFixture(): Promise<{ jwk: JWK; token: string }> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk: JWK = { ...await exportJWK(publicKey), kid: "fake-es-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(`${HOST}/auth/v1`).setAudience("authenticated").setSubject("fake-user")
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(privateKey);
  return { jwk, token };
}

/** Authenticate an expired token presented under an arbitrary scheme spelling. */
async function authenticateExpired(scheme: (token: string) => string) {
  const { jwk, token } = await expiredFixture();
  const served = new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  return authenticate(authorized(scheme(token)), ENV, stubFetch(() => served));
}

void test("a lowercase bearer scheme is still a presented credential", async () => {
  assert.deepEqual(await authenticateExpired((t) => `bearer ${t}`), { ok: false, reason: "invalid" });
});

void test("an uppercase BEARER scheme is still a presented credential", async () => {
  assert.deepEqual(await authenticateExpired((t) => `BEARER ${t}`), { ok: false, reason: "invalid" });
});

void test("a mixed-case BeArEr scheme is still a presented credential", async () => {
  assert.deepEqual(await authenticateExpired((t) => `BeArEr ${t}`), { ok: false, reason: "invalid" });
});

void test("a tab between scheme and token is still a presented credential", async () => {
  assert.deepEqual(await authenticateExpired((t) => `Bearer\t${t}`), { ok: false, reason: "invalid" });
});

void test("extra spaces between scheme and token do not hide the credential", async () => {
  assert.deepEqual(await authenticateExpired((t) => `Bearer   ${t}`), { ok: false, reason: "invalid" });
});

void test("a scheme that merely starts with bearer is not our scheme", async () => {
  // `Bearerish` is a different auth-scheme token, not a separator-less Bearer.
  const result = await authenticate(
    authorized("Bearerish abc.def.ghi"), ENV, stubFetch(() => new Response("", { status: 500 })),
  );
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("a bearer scheme whose token is only whitespace presents nothing", async () => {
  // `\x0B` survives HTTP header trimming (which strips only SP and HTAB) but
  // not JS `trim()`, so this is the one reachable empty-token case.
  const result = await authenticate(
    authorized("Bearer \x0B"), ENV, stubFetch(() => new Response("", { status: 500 })),
  );
  assert.deepEqual(result, { ok: false, reason: "absent" });
});
