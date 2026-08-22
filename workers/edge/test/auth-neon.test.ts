import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { authenticate, issuerFromJwksUrl } from "../src/identity/auth.ts";

const JWKS_SUFFIX = "/.well-known/jwks.json";

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    return Promise.resolve(handler(url));
  };
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

async function fixture(host: string, { alg = "EdDSA", issuer, audience, exp = "15m" }: {
  alg?: string; issuer?: string; audience?: string; exp?: string | number;
} = {}) {
  const pair = alg === "ES256"
    ? await generateKeyPair("ES256", { extractable: true })
    : await generateKeyPair("EdDSA", { extractable: true });
  const jwk = { ...await exportJWK(pair.publicKey), kid: `fake-${alg.toLowerCase()}-key` };
  const token = await new SignJWT({}).setProtectedHeader({ alg, kid: jwk.kid })
    .setIssuer(issuer ?? host).setAudience(audience ?? host).setSubject("fake-neon-user")
    .setIssuedAt().setExpirationTime(exp).sign(pair.privateKey);
  return { jwk, token };
}

function jwks(jwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function neonEnv(host: string) {
  return { NEON_AUTH_JWKS_URL: `${host}${JWKS_SUFFIX}` };
}

void test("issuerFromJwksUrl is the Neon Auth host origin, not the /neondb/auth path", () => {
  assert.equal(
    issuerFromJwksUrl("https://auth.example.test/neondb/auth/.well-known/jwks.json"),
    "https://auth.example.test",
  );
});

void test("issuerFromJwksUrl uses origin when the URL has no well-known suffix", () => {
  assert.equal(issuerFromJwksUrl("https://auth.example.test/neondb/auth"), "https://auth.example.test");
});

void test("a valid EdDSA token for the derived issuer/audience is accepted", async () => {
  const host = "https://neon-ok.example.test";
  const { jwk, token } = await fixture(host);
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: true, userId: "fake-neon-user", userType: "human" });
});

void test("a token for a weaker issuer is rejected", async () => {
  const host = "https://neon-wrong-issuer.example.test";
  const { jwk, token } = await fixture(host, { issuer: "https://neon-other.example.test" });
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("a token for a weaker audience is rejected", async () => {
  const host = "https://neon-wrong-audience.example.test";
  const { jwk, token } = await fixture(host, { audience: "https://neon-other.example.test" });
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("a token signed by another key is rejected", async () => {
  const host = "https://neon-bad-signature.example.test";
  const trusted = await fixture(host);
  const untrusted = await fixture(host);
  const r = await authenticate(bearer(untrusted.token), neonEnv(host), stubFetch(() => jwks(trusted.jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("an expired token is rejected", async () => {
  const host = "https://neon-expired.example.test";
  const { jwk, token } = await fixture(host, { exp: Math.floor(Date.now() / 1000) - 60 });
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});

void test("an ES256 token is rejected by the EdDSA-only algorithm pin", async () => {
  const host = "https://neon-wrong-alg.example.test";
  const { jwk, token } = await fixture(host, { alg: "ES256" });
  const r = await authenticate(bearer(token), neonEnv(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false, reason: "invalid" });
});
