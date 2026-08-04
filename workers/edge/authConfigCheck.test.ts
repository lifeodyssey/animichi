// Issue #709: post-deploy secret-drift check. authConfigStatus() is what
// actually gives the deployed Worker's real, currently-bound env values a
// voice — config-time tests (authConfig.test.ts) can only ever see the
// `wrangler.toml` var, never the secret's real deployed value.
import assert from "node:assert/strict";
import test from "node:test";
import { authConfigStatus } from "./authConfigCheck.ts";
import { createWorkerApp } from "./app.ts";

const ISSUER = "https://a.example.invalid/db/auth";
const MATCHING_JWKS = `${ISSUER}/.well-known/jwks.json`;
const DRIFTED_JWKS = "https://b.example.invalid/.well-known/jwks.json";

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

void test("GET /internal/auth-config exposes the verdict as JSON and never the URLs themselves", async () => {
  const app = createWorkerApp({});
  const env = {
    SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k",
    NEON_AUTH_ENABLED: "true", NEON_AUTH_ISSUER: ISSUER, NEON_AUTH_JWKS_URL: DRIFTED_JWKS,
  };
  const res = await app.request("/internal/auth-config", {}, env);
  const body = (await res.json()) as { neonAuthEnabled: boolean; jwksIssuerMatch: boolean | null };
  assert.equal(res.status, 200);
  assert.deepEqual(body, { neonAuthEnabled: true, jwksIssuerMatch: false });
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(ISSUER), false, "response body must never include the real issuer URL");
  assert.equal(raw.includes(DRIFTED_JWKS), false, "response body must never include the real JWKS URL");
});
