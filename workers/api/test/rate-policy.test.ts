import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-paths";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { PUBLIC_CATALOG_ROUTES } from "@animichi/contract/public-catalog";
import { classifyRatePolicy, RATE_LIMIT_ENVELOPE_FIELDS, type LimiterKind, type LimiterFailure, type RatePolicy } from "../src/gateway/rate-policy.ts";
import { authenticatedRateLimitKey } from "../src/protect/rate-limiter.ts";

// AC1 (#680): ONE route policy classifies every public API operation by
// identity key, cost, quota relationship, retry contract, and limiter
// failure mode. These tests pin the classification table so routing
// order, encoding, trailing slash, or another isolate cannot silently
// drop a class out of the policy (the AC2 property, at the policy seam).

function classify(method: string, path: string): RatePolicy {
  return classifyRatePolicy(method, path);
}

// Every /v1 agent operation in the inventory must classify — never undefined.
void test("every AGENT_PATHS operation classifies (never undefined)", () => {
  for (const op of AGENT_PATHS) {
    const p = classify(op.method, op.path);
    assert.ok(p, `${op.method} ${op.path} must classify`);
    assert.equal(typeof p.cost, "string");
    assert.equal(typeof p.quota, "string");
    assert.equal(typeof p.limiter, "string");
    assert.equal(typeof p.failure, "string");
  }
});

void test("the allowlisted public catalog reads are native fail-open cacheable reads", () => {
  const p = classify("GET", "/catalog/public/anime-overview/123");
  assert.deepEqual(p, { cost: "low", quota: "none", limiter: "native", failure: "fail-open-alert" });
  // One case per route the declaration carries, derived from it: a new public
  // catalog route that forgets its rate cell fails here rather than shipping
  // unmetered (#1691 AC2).
  assert.equal(PUBLIC_CATALOG_ROUTES.length > 0, true, "the declaration must not be empty");
  for (const route of PUBLIC_CATALOG_ROUTES) {
    const concrete = route.template.replace(/\{[^}]+\}/g, "123");
    assert.deepEqual(classify("GET", concrete), p, `${route.template} must classify as a public read`);
  }
});

void test("high-cost chat (POST) is durable and fails closed, regardless of route", () => {
  const std = classify("POST", "/v1/chat");
  const trailing = classify("POST", "/v1/chat/");
  const encoded = classify("POST", "/v1/%63hat");
  for (const p of [std, trailing, encoded]) {
    assert.equal(p.cost, "high");
    assert.equal(p.limiter, "durable");
    assert.equal(p.failure, "fail-closed");
  }
});

void test("BYOK probe is a high-cost durable fail-closed class (abuse cannot be bypassed)", () => {
  assert.equal(classify("POST", "/v1/byok/probe").limiter, "durable");
  assert.equal(classify("POST", "/v1/byok/probe").failure, "fail-closed");
  assert.equal(classify("POST", "/v1/byok/%70robe").limiter, "durable");
});

// #1604 deleted the two photo-search routes, so their paths leave the inventory and
// the derived tables together. A path no longer in the inventory must classify as an
// unmanaged read. The mutation this pins is re-adding the path to the AGENT_PATHS
// inventory (`HIGH_COST_V1` alone is unreachable for a path the inventory does not
// carry, which is why #1604's cell-only mutation M2a was inert) — the inventory
// assertion below is the one that goes red first.
void test("the deleted photo-search paths are out of the inventory and unmanaged", () => {
  for (const path of ["/v1/photo-search", "/v1/photo-search/confirm"]) {
    assert.equal(AGENT_PATHS.some((entry) => entry.path === path), false, `${path} must leave the inventory with its route`);
    const p = classify("POST", path);
    assert.equal(p.cost, "low");
    assert.equal(p.limiter, "none");
    assert.equal(p.failure, "fail-open-alert");
  }
});

// HIGH_COST_V1 selects the DURABLE_HIGH_COST cell. BYOK shares the
// high-cost/durable/fail-closed shape but reports to the caller's BILLING meter, so
// the quota cell (`none` here, `billing` there) is what tells the two apart — this
// assertion is that cell's only inventory member.
void test("chat is the only DURABLE_HIGH_COST operation the inventory still carries", () => {
  const highCostV1 = AGENT_PATHS.filter((entry) => {
    const p = classify(entry.method, entry.path);
    return p.cost === "high" && p.limiter === "durable" && p.quota === "none";
  }).map((entry) => `${entry.method} ${entry.path}`);
  assert.deepEqual(highCostV1, ["POST /v1/chat"], "a deleted path re-entering the inventory as high-cost turns this red");
});

void test("authenticated reads stay unmanaged (GET conversation surfaces)", () => {
  for (const path of ["/v1/conversations", "/v1/conversations/abc/messages", "/v1/conversations/abc/routes"]) {
    assert.equal(classify("GET", path).limiter, "none");
  }
});

void test("retired conversation rename is unmanaged", () => {
  const p = classify("PATCH", "/v1/conversations/abc");
  assert.equal(p.limiter, "none");
});

void test("users GET is unmanaged; users POST/DELETE are durable fail-closed mutations", () => {
  assert.equal(classify("GET", "/v1/users/saved-routes").limiter, "none");
  const put = classify("POST", "/v1/users/saved-routes");
  const del = classify("DELETE", "/v1/users/saved-routes/xyz");
  for (const p of [put, del]) {
    assert.equal(p.limiter, "durable");
    assert.equal(p.failure, "fail-closed");
  }
});

void test("session adopt is a durable fail-closed mutation", () => {
  const p = classify("POST", "/v1/sessions/adopt");
  assert.equal(p.limiter, "durable");
  assert.equal(p.failure, "fail-closed");
});

// Identity key: high-cost classes must key on the worker-verified identity only.
void test("durable classes key on the worker-verified identity, never a caller header", () => {
  assert.equal(authenticatedRateLimitKey("user-a"), "authed:user-a");
  assert.equal(USERS_BINDING_PREFIX, "/v1/users/");
});

// Retry contract: the limited envelope carries the documented fields (AC3).
void test("the documented rate-limit envelope fields are exactly code/message/retry_after_seconds", () => {
  assert.deepEqual(RATE_LIMIT_ENVELOPE_FIELDS, ["code", "message", "retry_after_seconds"]);
});

const LIMITER_KINDS: readonly LimiterKind[] = ["none", "native", "durable"];
const FAILURE_MODES: readonly LimiterFailure[] = ["fail-open-alert", "fail-closed"];

void test("every class uses a known limiter kind and failure mode (never untyped)", () => {
  for (const op of AGENT_PATHS) {
    const p = classify(op.method, op.path);
    assert.ok(LIMITER_KINDS.includes(p.limiter), op.path + " has an untyped limiter kind");
    assert.ok(FAILURE_MODES.includes(p.failure), op.path + " has an untyped failure mode");
  }
});
