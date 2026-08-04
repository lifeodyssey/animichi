// Issue #709: post-deploy secret-drift check. authConfigStatus() is what
// actually gives the deployed Worker's real, currently-bound env values a
// voice — config-time tests (authConfig.test.ts) can only ever see the
// `wrangler.toml` var, never the secret's real deployed value.
//
// Review follow-up (same issue): GET /internal/auth-config sits after
// /healthz and before the /v1/* authenticate() chain in app.ts, so without
// its own gate it would be reachable by anyone on the public internet with
// no credential — `/internal/` names an intent, not a network boundary on a
// Cloudflare Worker. isDiagAuthorized() is that gate; the tests below cover
// both the pure gate function and the wired route end to end.
import assert from "node:assert/strict";
import test from "node:test";
import { authConfigStatus, isDiagAuthorized } from "./authConfigCheck.ts";
import { createWorkerApp } from "./app.ts";

const ISSUER = "https://a.example.invalid/db/auth";
const MATCHING_JWKS = `${ISSUER}/.well-known/jwks.json`;
const DRIFTED_JWKS = "https://b.example.invalid/.well-known/jwks.json";
const DIAG_TOKEN = "fixed-test-diag-token-0000000000000000";

function diagRequest(auth?: string): Request {
  return new Request("https://app.example.test/internal/auth-config", {
    headers: auth === undefined ? {} : { Authorization: auth },
  });
}

void test("Neon Auth disabled reports neonAuthEnabled:false and no verdict", () => {
  const status = authConfigStatus({ SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.deepEqual(status, { neonAuthEnabled: false, jwksIssuerMatch: null });
});

void test("Neon Auth enabled, JWKS explicitly disabled by empty string, reports false", () => {
  const status = authConfigStatus({
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k",
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: "",
  });
  assert.deepEqual(status, { neonAuthEnabled: true, jwksIssuerMatch: false });
});

void test("Neon Auth enabled and JWKS matches the issuer-derived URL reports true", () => {
  const status = authConfigStatus({
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k",
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: MATCHING_JWKS,
  });
  assert.deepEqual(status, { neonAuthEnabled: true, jwksIssuerMatch: true });
});

void test("Neon Auth enabled and JWKS points elsewhere (drift) reports false", () => {
  const status = authConfigStatus({
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k",
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: DRIFTED_JWKS,
  });
  assert.deepEqual(status, { neonAuthEnabled: true, jwksIssuerMatch: false });
});

// ── isDiagAuthorized (the gate) ─────────────────────────────────────────────

void test("no Authorization header is denied", () => {
  const env = { SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k", POST_DEPLOY_DIAG_TOKEN: DIAG_TOKEN };
  assert.equal(isDiagAuthorized(diagRequest(), env), false);
});

void test("a wrong bearer token is denied", () => {
  const env = { SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k", POST_DEPLOY_DIAG_TOKEN: DIAG_TOKEN };
  assert.equal(isDiagAuthorized(diagRequest("Bearer not-the-real-token"), env), false);
});

void test("an unset POST_DEPLOY_DIAG_TOKEN denies every request, fail-closed", () => {
  const env = { SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.equal(isDiagAuthorized(diagRequest(`Bearer ${DIAG_TOKEN}`), env), false);
  assert.equal(isDiagAuthorized(diagRequest(), env), false);
});

void test("the correct bearer token is authorized", () => {
  const env = { SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k", POST_DEPLOY_DIAG_TOKEN: DIAG_TOKEN };
  assert.equal(isDiagAuthorized(diagRequest(`Bearer ${DIAG_TOKEN}`), env), true);
});

// ── GET /internal/auth-config, wired end to end ─────────────────────────────

void test("an unauthenticated GET /internal/auth-config gets the same 404 as an unmapped path", async () => {
  const app = createWorkerApp({});
  const env = {
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k", POST_DEPLOY_DIAG_TOKEN: DIAG_TOKEN,
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: DRIFTED_JWKS,
  };
  const [unauthed, unmapped] = await Promise.all([
    app.request("/internal/auth-config", {}, env),
    app.request("/this-route-does-not-exist", {}, env),
  ]);
  assert.equal(unauthed.status, 404);
  assert.equal(unmapped.status, 404);
  assert.deepEqual(await unauthed.json(), await unmapped.json());
});

void test("an authenticated GET /internal/auth-config exposes the verdict and never the URLs themselves", async () => {
  const app = createWorkerApp({});
  const env = {
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k", POST_DEPLOY_DIAG_TOKEN: DIAG_TOKEN,
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: DRIFTED_JWKS,
  };
  const res = await app.request("/internal/auth-config", { headers: { Authorization: `Bearer ${DIAG_TOKEN}` } }, env);
  const body = (await res.json()) as { neonAuthEnabled: boolean; jwksIssuerMatch: boolean | null };
  assert.equal(res.status, 200);
  assert.deepEqual(body, { neonAuthEnabled: true, jwksIssuerMatch: false });
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(ISSUER), false, "response body must never include the real issuer URL");
  assert.equal(raw.includes(DRIFTED_JWKS), false, "response body must never include the real JWKS URL");
});
