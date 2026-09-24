import test from "node:test";
import assert from "node:assert/strict";
import { classifyRatePolicy, serviceCredentialKey, serviceCredentialPolicy } from "../src/gateway/rate-policy.ts";

// AC5 (#680): BYOK changes BILLING quota only and can never bypass abuse
// limits; service credentials carry a SEPARATE policy cell from users and
// anonymous callers, so machine identity never inherits (or resets into) a
// human limit.

void test("BYOK belongs to the durable fail-closed abuse class (cannot bypass the limiter)", () => {
  for (const path of ["/v1/byok/probe", "/v1/byok/%70robe", "/v1/byok/probe/"]) {
    const p = classifyRatePolicy("POST", path);
    assert.equal(p.limiter, "durable", path + " must stay on the durable abuse limiter");
    assert.equal(p.failure, "fail-closed", path + " must fail closed");
  }
});

void test("BYOK reports to the BILLING quota cell only, never the anonymous daily meters", () => {
  const p = classifyRatePolicy("POST", "/v1/byok/probe");
  assert.equal(p.quota, "billing");
  assert.notEqual(p.quota, "daily-message");
  assert.notEqual(p.quota, "daily-cost");
});

void test("BYOK changing billing quota does not lift the rate-limit/abuse window", () => {
  const p = classifyRatePolicy("POST", "/v1/byok/probe");
  assert.equal(p.limiter, "durable");
  assert.equal(p.failure, "fail-closed");
});

void test("service credentials have a SEPARATE policy cell and key namespace", () => {
  const svc = serviceCredentialPolicy();
  assert.equal(svc.limiter, "durable");
  assert.equal(svc.failure, "fail-closed");
  assert.equal(svc.quota, "billing");
  assert.match(serviceCredentialKey("worker-bot"), /^svc:worker-bot$/);
  assert.equal(serviceCredentialKey("worker-bot").startsWith("authed:"), false);
});

void test("service credentials never classify into the anonymous or user-cell tables", () => {
  const anon = classifyRatePolicy("POST", "/v1/chat");
  assert.notEqual(anon.quota, "billing");
});
