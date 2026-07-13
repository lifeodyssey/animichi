import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate } from "./auth.ts";

const ENV = { SUPABASE_URL: "https://sb-base.example.test", SUPABASE_SERVICE_ROLE_KEY: "service" };

function stubFetch(handler: (url: string, init?: RequestInit) => Response, urls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    return handler(String(input), init);
  }) as unknown as typeof fetch;
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

async function esFixture(host: string, issuer = `${host}/auth/v1`, exp: string | number = "1h") {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fake-es-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(issuer).setAudience("authenticated").setSubject("fake-user").setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, token };
}

function jwks(jwk: JsonWebKey): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("no Authorization header -> {ok:false}", async () => {
  const r = await authenticate(new Request("https://app.example.test/v1/chat"), ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});

test("valid sk_ key -> agent + userId from api_keys", async () => {
  const r = await authenticate(bearer("sk_fake_valid"), ENV, stubFetch((url) => {
    if (url.includes("/rest/v1/api_keys") && url.includes("select=user_id"))
      return new Response(JSON.stringify([{ user_id: "fake-agent" }]), { status: 200 });
    return new Response("", { status: 200 });
  }));
  assert.deepEqual(r, { ok: true, userId: "fake-agent", userType: "agent" });
});

test("unknown sk_ key (no rows) -> {ok:false}", async () => {
  const r = await authenticate(bearer("sk_fake_unknown"), ENV, stubFetch((url) =>
    url.includes("/rest/v1/api_keys") ? new Response("[]", { status: 200 }) : new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});

test("valid ES256 token verifies locally", async () => {
  const host = "https://sb-valid.example.test";
  const { jwk, token } = await esFixture(host);
  const urls: string[] = [];
  const r = await authenticate(bearer(token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(jwk), urls));
  assert.deepEqual(r, { ok: true, userId: "fake-user", userType: "human" });
  assert.deepEqual(urls, [`${host}/auth/v1/.well-known/jwks.json`]);
  assert.equal(urls.some((url) => url.endsWith("/auth/v1/user")), false);
});

test("expired ES256 token is rejected", async () => {
  const host = "https://sb-expired.example.test";
  const { jwk, token } = await esFixture(host, `${host}/auth/v1`, Math.floor(Date.now() / 1000) - 60);
  const r = await authenticate(bearer(token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false });
});

test("wrong Supabase issuer is rejected", async () => {
  const host = "https://sb-wrong-issuer.example.test";
  const { jwk, token } = await esFixture(host, "https://sb-other-issuer.example.test/auth/v1");
  const r = await authenticate(bearer(token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(jwk)));
  assert.deepEqual(r, { ok: false });
});

test("ES256 token signed by another key is rejected", async () => {
  const host = "https://sb-bad-signature.example.test";
  const trusted = await esFixture(host);
  const untrusted = await esFixture(host);
  const r = await authenticate(bearer(untrusted.token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => jwks(trusted.jwk)));
  assert.deepEqual(r, { ok: false });
});

test("HS256 token is rejected", async () => {
  const host = "https://sb-hs256.example.test";
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "fake-hs-key" })
    .setIssuer(`${host}/auth/v1`).setAudience("authenticated").setSubject("fake-user").setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode("fake-secret-with-at-least-32-bytes"));
  const r = await authenticate(bearer(token), { ...ENV, SUPABASE_URL: host }, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(r, { ok: false });
});

test("garbage token is rejected", async () => {
  const r = await authenticate(bearer("not-a-jwt"), { ...ENV, SUPABASE_URL: "https://sb-garbage.example.test" }, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(r, { ok: false });
});
