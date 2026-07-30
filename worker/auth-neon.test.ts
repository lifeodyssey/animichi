import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate } from "./auth.ts";

const BASE_ENV = { SUPABASE_URL: "https://sb-neon-base.example.test", SUPABASE_SERVICE_ROLE_KEY: "service" };

function stubFetch(handler: (url: string, init?: RequestInit) => Response, urls: string[] = []): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = input instanceof Request ? input.url : input.toString();
    urls.push(inputUrl);
    return Promise.resolve(handler(inputUrl, init));
  });
}

function bearer(token: string): Request {
  return new Request("https://app-neon.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

async function fixture(alg: "EdDSA" | "ES256", issuer: string, audience = issuer, exp: string | number = "15m") {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: `fake-${alg.toLowerCase()}-key` };
  const token = await new SignJWT({ email: "fake@example.test" }).setProtectedHeader({ alg, kid: jwk.kid })
    .setIssuer(issuer).setAudience(audience).setSubject("fake-neon-user").setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, token };
}

function jwks(jwk: JsonWebKey): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function neonEnv(host: string) {
  return { ...BASE_ENV, NEON_AUTH_ENABLED: "true", NEON_AUTH_JWKS_URL: `${host}/.well-known/jwks.json`, NEON_AUTH_ISSUER: host };
}

void test("flag absent rejects EdDSA without fetching Neon JWKS", async () => {
  const host = "https://neon-absent.example.test";
  const { token } = await fixture("EdDSA", host);
  const urls: string[] = [];
  const r = await authenticate(bearer(token), BASE_ENV, stubFetch(() => new Response("", { status: 500 }), urls));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  assert.equal(urls.includes(`${host}/.well-known/jwks.json`), false);
});

void test("false flag rejects EdDSA without fetching Neon JWKS", async () => {
  const host = "https://neon-disabled.example.test";
  const { token } = await fixture("EdDSA", host);
  const urls: string[] = [];
  const env = { ...neonEnv(host), NEON_AUTH_ENABLED: "false" };
  const r = await authenticate(bearer(token), env, stubFetch(() => new Response("", { status: 500 }), urls));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  assert.equal(urls.includes(env.NEON_AUTH_JWKS_URL), false);
});

void test("enabled Neon accepts a valid EdDSA token", async () => {
  const host = "https://neon-valid.example.test";
  const { jwk, token } = await fixture("EdDSA", host);
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: true, userId: "fake-neon-user", userType: "human" });
});

void test("enabled Neon rejects wrong issuer", async () => {
  const host = "https://neon-wrong-issuer.example.test";
  const { jwk, token } = await fixture("EdDSA", "https://neon-other-issuer.example.test", host);
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("enabled Neon rejects expired token", async () => {
  const host = "https://neon-expired.example.test";
  const { jwk, token } = await fixture("EdDSA", host, host, Math.floor(Date.now() / 1000) - 60);
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("enabled Neon rejects wrong audience", async () => {
  const host = "https://neon-wrong-audience.example.test";
  const { jwk, token } = await fixture("EdDSA", host, "https://neon-other-audience.example.test");
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("enabled Neon rejects signature from another key", async () => {
  const host = "https://neon-bad-signature.example.test";
  const trusted = await fixture("EdDSA", host);
  const untrusted = await fixture("EdDSA", host);
  const r = await authenticate(bearer(untrusted.token), neonEnv(host), stubFetch(() => jwks(trusted.jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("enabled Neon coexists with Supabase", async () => {
  const neonHost = "https://neon-dual.example.test";
  const sbHost = "https://sb-dual.example.test";
  const neon = await fixture("EdDSA", neonHost);
  const sb = await fixture("ES256", `${sbHost}/auth/v1`, "authenticated", "1h");
  const env = { ...neonEnv(neonHost), SUPABASE_URL: sbHost };
  const urls: string[] = [];
  const fetcher = stubFetch((url) => jwks(url === env.NEON_AUTH_JWKS_URL ? neon.jwk : sb.jwk), urls);
  const sbResult = await authenticate(bearer(sb.token), env, fetcher);
  const neonResult = await authenticate(bearer(neon.token), env, fetcher);
  assert.deepEqual(sbResult, { ok: true, userId: "fake-neon-user", userType: "human" });
  assert.deepEqual(neonResult, { ok: true, userId: "fake-neon-user", userType: "human" });
  assert.deepEqual(urls, [`${sbHost}/auth/v1/.well-known/jwks.json`, env.NEON_AUTH_JWKS_URL]);
});

void test("enabled Neon without JWKS URL rejects without throwing", async () => {
  const host = "https://neon-missing-jwks.example.test";
  const { token } = await fixture("EdDSA", host);
  const env = { ...BASE_ENV, NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: host };
  const r = await authenticate(bearer(token), env, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("sk_ token still uses api_keys when Neon is enabled", async () => {
  const host = "https://neon-api-key.example.test";
  const r = await authenticate(bearer("sk_fake_neon"), neonEnv(host), stubFetch((url) =>
    url.includes("select=user_id") ? new Response(JSON.stringify([{ user_id: "fake-agent" }]), { status: 200 }) : new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: true, userId: "fake-agent", userType: "agent" });
});
