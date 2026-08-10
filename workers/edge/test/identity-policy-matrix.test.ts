import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { DEFAULT_IDENTITY_POLICY, identityPolicySchema } from "@animichi/contract/identity";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";
import { authRateLimitConfigFrom, rateLimitConfigFrom } from "../src/protect/rate-limiter.ts";

// AUTH-1 #945: the explicit public/anonymous/authenticated matrix. Every
// numeric cell is pinned at its consumers — the deployed wrangler.toml config,
// the rate-limiter defaults, and the closed identity-class schema — so a
// divergent hardcoded value, a restored api_keys table, an accepted `agent`
// class, or a BYOK header promoting an anonymous caller all fail here.

const WRANGLER_TOML = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const wranglerToml = readFileSync(WRANGLER_TOML, "utf8");
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/neon/", import.meta.url));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockFor(header: string): string {
  const match = new RegExp(`^${escapeRegExp(header)}$`, "m").exec(wranglerToml);
  assert.ok(match, `wrangler.toml must contain a "${header}" section header`);
  const start = match.index;
  const next = wranglerToml.indexOf("\n[", start + header.length);
  return wranglerToml.slice(start, next === -1 ? undefined : next);
}

function numericInBlock(header: string, key: string): number {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m").exec(blockFor(header));
  assert.ok(match, `"${header}" must set ${key}`);
  const value = Number(match[1]);
  assert.ok(Number.isFinite(value), `${key} in "${header}" must be numeric`);
  return value;
}

const ANON = DEFAULT_IDENTITY_POLICY.anonymous;
const AUTH = DEFAULT_IDENTITY_POLICY.authenticated;
const anonRate = ANON.rateLimit;
const authRate = AUTH.rateLimit;
assert.ok(anonRate, "the anonymous class must define a rate limit in the policy");
assert.ok(authRate, "the authenticated class must define a rate limit in the policy");

for (const [header, label] of [
  ["[vars]", "root/dev"],
  ["[env.production.vars]", "production"],
  ["[env.staging.vars]", "staging"],
] as const) {
  void test(`anonymous matrix cells match the IdentityPolicy in ${label}`, () => {
    assert.equal(numericInBlock(header, "ANON_RATE_LIMIT"), anonRate.limit);
    assert.equal(numericInBlock(header, "ANON_RATE_LIMIT_WINDOW_SECONDS"), anonRate.windowSeconds);
    assert.equal(numericInBlock(header, "ANON_DAILY_MESSAGE_QUOTA"), ANON.dailyMessageQuota);
    assert.equal(numericInBlock(header, "ANON_DAILY_COST_BUDGET_USD"), ANON.dailyCostBudgetUsd);
  });

  void test(`authenticated matrix cells match the IdentityPolicy in ${label}`, () => {
    assert.equal(numericInBlock(header, "AUTH_RATE_LIMIT"), authRate.limit);
    assert.equal(numericInBlock(header, "AUTH_RATE_LIMIT_WINDOW_SECONDS"), authRate.windowSeconds);
  });
}

void test("rate-limiter defaults come from the IdentityPolicy, never hardcoded literals", () => {
  assert.deepEqual(rateLimitConfigFrom({}), { limit: anonRate.limit, windowSeconds: anonRate.windowSeconds });
  assert.deepEqual(authRateLimitConfigFrom({}), { limit: authRate.limit, windowSeconds: authRate.windowSeconds });
});

void test("the identity matrix is closed: an agent class is rejected by the schema", () => {
  const withAgent = {
    ...DEFAULT_IDENTITY_POLICY,
    agent: { rateLimit: null, dailyMessageQuota: null, dailyCostBudgetUsd: null },
  };
  assert.equal(identityPolicySchema.safeParse(withAgent).success, false, "an accepted agent class would resurrect the deleted identity path");
});

void test("api_keys exists only as append-only history and is dropped by the newest migration", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  const sql = (name: string): string => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");
  const creates = files.filter((name) =>
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.api_keys/i.test(sql(name)));
  const drops = files.filter((name) =>
    /drop\s+table(?:\s+if\s+exists)?\s+public\.api_keys/i.test(sql(name)));
  assert.deepEqual(creates, ["20260809000009_table_api_keys.sql"], "the historical create stays for append-only history");
  assert.equal(drops.length, 1, "exactly one migration must drop api_keys");
  const dropName = drops[0] ?? "";
  assert.ok(files.indexOf(dropName) > files.indexOf("20260809000009_table_api_keys.sql"), "the drop must follow the create");
  assert.equal(files[files.length - 1], dropName, "the drop must be the newest migration — restoring the table fails this check");
});

void test("anonymous BYOK is never promoted to authenticated (X-User-Type stays anonymous)", async () => {
  const captured = { requests: [] as Request[] };
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
  });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: {
      idFromName: () => "id",
      get: () => ({
        fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
      }),
    },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (r: Request) => {
          captured.requests.push(r);
          return Promise.resolve(new Response("container"));
        },
      }),
    },
  } as never;
  const res = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-fake",
      "X-BYOK-Base-Url": "https://evil.example",
    },
  }, env, stubCtx);
  assert.equal(res.status, 200, "the anonymous chat flow still serves the request");
  const forwarded = captured.requests[0];
  assert.ok(forwarded, "the container must receive the anonymous request");
  assert.equal(forwarded.headers.get("X-User-Type"), "anonymous");
  assert.match(String(forwarded.headers.get("X-User-Id")), /^anon_/);
});
