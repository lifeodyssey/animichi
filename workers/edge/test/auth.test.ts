import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { authenticate } from "../src/identity/auth.ts";

const ENV = { NEON_AUTH_JWKS_URL: "https://neon-base.example.test/.well-known/jwks.json" };

function stubFetch(handler: (url: string, init?: RequestInit) => Response, urls: string[] = []): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = input instanceof Request ? input.url : input.toString();
    urls.push(inputUrl);
    return Promise.resolve(handler(inputUrl, init));
  });
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

/** Mint an EdDSA token for a Neon Auth branch whose JWKS URL is `jwksUrl`. */
async function edFixture(jwksUrl: string, { exp = "15m", iss, aud }: { exp?: string | number; iss?: string; aud?: string } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fake-eddsa-key" };
  const issuer = iss ?? jwksUrl.slice(0, -"/.well-known/jwks.json".length);
  const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
    .setIssuer(issuer).setAudience(aud ?? issuer).setSubject("fake-user").setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, token };
}

function jwks(jwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
}

void test("no Authorization header -> {ok:false, reason:absent}", async () => {
  const r = await authenticate(new Request("https://app.example.test/v1/chat"), ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false, reason: "absent" });
});

void test("an sk_ credential is invalid, never an agent (AUTH-1: api_keys deleted)", async () => {
  const urls: string[] = [];
  const r = await authenticate(
    bearer("sk_fake_agent"), ENV,
    stubFetch(() => new Response("", { status: 500 }), urls),
  );
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  assert.deepEqual(urls, [], "an sk_ credential must never trigger a JWKS fetch");
});

void test("a valid EdDSA token verifies against the Neon JWKS", async () => {
  const host = "https://neon-valid.example.test";
  const { jwk, token } = await edFixture(`${host}/.well-known/jwks.json`);
  const urls: string[] = [];
  const r = await authenticate(bearer(token), { NEON_AUTH_JWKS_URL: `${host}/.well-known/jwks.json` }, stubFetch(() => jwks(jwk), urls));
  assert.deepEqual(r, { ok: true, userId: "fake-user", userType: "human" });
  assert.deepEqual(urls, [`${host}/.well-known/jwks.json`]);
});

void test("garbage token is rejected", async () => {
  const r = await authenticate(bearer("not-a-jwt"), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("no JWKS URL configured fails closed — no Supabase fallback", async () => {
  const { token } = await edFixture("https://neon-unconfigured.example.test/.well-known/jwks.json");
  const urls: string[] = [];
  const r = await authenticate(bearer(token), {}, stubFetch(() => new Response("", { status: 500 }), urls));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  assert.deepEqual(urls, [], "an unconfigured branch must never reach a Supabase or Neon endpoint");
});

void test("a former Supabase token is rejected (AUTH-2: Supabase verification deleted)", async () => {
  // ES256, `iss = <supabase>/auth/v1`, `aud = authenticated` — exactly the
  // credential the old dual-issuer path accepted. Accepting it again is the
  // rollback mutation; this test pins the cutover.
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fake-es-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer("https://sb-legacy.example.test/auth/v1").setAudience("authenticated")
    .setSubject("fake-user").setIssuedAt().setExpirationTime("1h").sign(privateKey);
  const urls: string[] = [];
  const served = new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  const r = await authenticate(bearer(token), ENV, stubFetch(() => served, urls));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  assert.equal(urls.includes("https://sb-legacy.example.test/auth/v1/.well-known/jwks.json"), false);
});
