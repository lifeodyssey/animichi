import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { GITHUB_OIDC_ISSUER, createGitHubOidcVerifier, type GitHubOidcClaims } from "@animichi/contract/oidc-github";
import { exchangeForGateSession, exchangeStatus, STAGING_GATE_EXCHANGE_PATH } from "../src/staging-gate/exchange.ts";
import { STAGING_GATE_OIDC_AUDIENCE, STAGING_GATE_OIDC_POLICY, STAGING_GATE_TRUSTED_WORKFLOW } from "../src/staging-gate/policy.ts";
import { createGateSession, isValidGateSession, memoryGateSessionStore, newSessionId, STAGING_GATE_SESSION_HEADER, type GateSessionStore } from "../src/staging-gate/session.ts";

// #1054 — staging-gate OIDC exchange (CI channel). Reuses the SAME shared
// @animichi/contract/oidc-github verifier (one implementation, two doors) with
// a DISTINCT audience from the migrator. Valid CI OIDC identity → the private
// smoke path is authorized (a short-lived gate session is issued); invalid →
// rejected; the human browser static-token channel is untouched.

const FIXED_NOW = new Date("2026-04-01T00:00:00.000Z").getTime();
const REPOSITORY = "lifeodyssey/animichi";

function claims(overrides: Partial<GitHubOidcClaims> = {}): GitHubOidcClaims {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: STAGING_GATE_OIDC_AUDIENCE,
    sub: 'repo:' + REPOSITORY + ':environment:staging',
    ref: "refs/heads/main",
    repository: REPOSITORY,
    environment: "staging",
    workflow_ref: STAGING_GATE_TRUSTED_WORKFLOW,
    job_workflow_ref: STAGING_GATE_TRUSTED_WORKFLOW,
    ...overrides,
  };
}

async function issuedToken(claimsOverrides: Partial<GitHubOidcClaims> = {}, audience = STAGING_GATE_OIDC_AUDIENCE, keyTag = "staging-gate-test-key") {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: keyTag } as JWK;
  const token = await new SignJWT(claims(claimsOverrides) as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: keyTag, typ: "JWT" })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(audience)
    .setIssuedAt(Math.floor(FIXED_NOW / 1000))
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, verifier: localVerifier(jwk) };
}

function localVerifier(jwk: JWK) {
  return createGitHubOidcVerifier(STAGING_GATE_OIDC_POLICY, createLocalJWKSet({ keys: [jwk] }));
}

function makeStore(): { store: GateSessionStore; nowMs: () => number } {
  return { store: memoryGateSessionStore(), nowMs: () => FIXED_NOW };
}

function exchangeRequest(url: string, token: string): Request {
  return new Request("https://edge.test" + url, { method: "POST", headers: token ? { Authorization: 'Bearer ' + token } : {} });
}

void test("a valid CI OIDC identity is granted a short-lived gate session (private smoke path authorized)", async () => {
  const { token, verifier } = await issuedToken();
  const { store, nowMs } = makeStore();
  const result = await exchangeForGateSession(exchangeRequest(STAGING_GATE_EXCHANGE_PATH, token), { verifier, store, nowMs });
  assert.equal(exchangeStatus(result), 200);
  // Fail loudly on a regression that returns a non-granted result with a 200
  // status (a silent no-session response would otherwise pass this test).
  assert.equal(result.kind, "granted");
  assert.equal(isValidGateSession(await store.get(result.session.id), nowMs()), true);
  assert.equal(result.session.expiresAtMs - nowMs(), 15 * 60 * 1000);
});

void test("a missing bearer token is rejected with 401", async () => {
  const { store, nowMs } = makeStore();
  const result = await exchangeForGateSession(exchangeRequest(STAGING_GATE_EXCHANGE_PATH, ""), { store, nowMs });
  assert.equal(result.kind, "missing-token");
  assert.equal(exchangeStatus(result), 401);
});

void test("a token from another repository is rejected (403)", async () => {
  const { token, verifier } = await issuedToken({ repository: "attacker/other" });
  const { store, nowMs } = makeStore();
  const result = await exchangeForGateSession(exchangeRequest(STAGING_GATE_EXCHANGE_PATH, token), { verifier, store, nowMs });
  assert.equal(result.kind, "denied");
  assert.equal(exchangeStatus(result), 403);
});

void test("a token minted for another audience (the migrator's) is rejected — distinct doors (403)", async () => {
  const { token, verifier } = await issuedToken({}, "animichi:github-actions:migrator");
  const { store, nowMs } = makeStore();
  const result = await exchangeForGateSession(exchangeRequest(STAGING_GATE_EXCHANGE_PATH, token), { verifier, store, nowMs });
  assert.equal(result.kind, "denied");
  assert.equal(exchangeStatus(result), 403);
});

void test("a token not anchored to staging is rejected (403)", async () => {
  const { token, verifier } = await issuedToken({ environment: undefined });
  const { store, nowMs } = makeStore();
  const result = await exchangeForGateSession(exchangeRequest(STAGING_GATE_EXCHANGE_PATH, token), { verifier, store, nowMs });
  assert.equal(result.kind, "denied");
});

void test("the minted session authorizes only while unexpired (bounded lifetime)", () => {
  const live = createGateSession(FIXED_NOW, "sess-live");
  assert.equal(isValidGateSession(live, FIXED_NOW + 15 * 60 * 1000 - 1), true);
  const dead = createGateSession(FIXED_NOW, "sess-dead");
  assert.equal(isValidGateSession(dead, FIXED_NOW + 15 * 60 * 1000 + 1), false);
  assert.equal(isValidGateSession("not-an-object", FIXED_NOW), false);
  assert.equal(isValidGateSession(null, FIXED_NOW), false);
});

void test("session ids are opaque high-entropy nonces", () => {
  const ids = new Set(Array.from({ length: 64 }, () => newSessionId()));
  assert.equal(ids.size, 64, "session ids must not collide");
  for (const id of ids) assert.match(id, /^[0-9a-f]{64}$/);
});

void test("the exchange path and session header are exported for gateway/WAF wiring", () => {
  assert.equal(STAGING_GATE_EXCHANGE_PATH, "/staging-gate/exchange");
  assert.equal(STAGING_GATE_SESSION_HEADER, "x-staging-session");
});
