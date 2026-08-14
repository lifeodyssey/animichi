import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-contract";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
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

void test("credential-free public reads are low-cost, native-tier, fail-open", () => {
  for (const path of ["/v1/search/preview", "/v1/bangumi/485/guide"]) {
    const p = classify("GET", path);
    assert.deepEqual(p, { cost: "low", quota: "none", limiter: "native", failure: "fail-open-alert" });
  }
});

void test("the allowlisted public catalog read is a native fail-open cacheable read", () => {
  const p = classify("GET", "/catalog/public/anime-overview/123");
  assert.deepEqual(p, { cost: "low", quota: "none", limiter: "native", failure: "fail-open-alert" });
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

void test("photo-search and confirm are durable fail-closed high-cost/mutation classes", () => {
  assert.equal(classify("POST", "/v1/photo-search").cost, "high");
  assert.equal(classify("POST", "/v1/photo-search").failure, "fail-closed");
  assert.equal(classify("POST", "/v1/photo-search/confirm").failure, "fail-closed");
});

void test("feedback is a mutation class: durable fail-closed, low cost", () => {
  assert.deepEqual(classify("POST", "/v1/feedback"), { cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });
});

void test("authenticated reads stay unmanaged (GET conversation surfaces)", () => {
  for (const path of ["/v1/conversations", "/v1/conversations/abc/messages", "/v1/conversations/abc/routes", "/v1/bangumi/nearby"]) {
    assert.equal(classify("GET", path).limiter, "none");
  }
});

void test("PATCH (rename conversation) is a durable fail-closed mutation", () => {
  const p = classify("PATCH", "/v1/conversations/abc");
  assert.equal(p.limiter, "durable");
  assert.equal(p.failure, "fail-closed");
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
