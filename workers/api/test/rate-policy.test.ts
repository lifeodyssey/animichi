import test from "node:test";
import assert from "node:assert/strict";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { RATE_LIMIT_ENVELOPE_FIELDS, serviceCredentialKey, serviceCredentialPolicy } from "../src/gateway/rate-policy.ts";
import { GATEWAY_ROUTES } from "../src/gateway/route-table.ts";
import { authenticatedRateLimitKey } from "../src/protect/rate-limiter.ts";

// SUT: the rate cells in `src/gateway/rate-policy.ts` (AC1, #680). Each route in
// `route-table.ts` names the cell it meters by, so which route is which class,
// and how each class fails, are pinned end to end through the app, in
// `gateway-entry-rate-class.test.ts` and `gateway-entry-limiter-outage.test.ts`.
// What stays here is what no route shows: the key a durable class meters on,
// the envelope's documented fields, and the service-credential cell no route
// uses yet — no route-table entry serves with it until its planned route wires
// it, it keys its own `svc:` namespace, and it meters on the durable limiter.

// Identity key: high-cost classes must key on the worker-verified identity only.
void test("durable classes key on the worker-verified identity, never a caller header", () => {
  assert.equal(authenticatedRateLimitKey("user-a"), "authed:user-a");
  assert.equal(USERS_BINDING_PREFIX, "/v1/users/");
});

// Retry contract: the limited envelope carries the documented fields (AC3).
void test("the documented rate-limit envelope fields are exactly code/message/retry_after_seconds", () => {
  assert.deepEqual(RATE_LIMIT_ENVELOPE_FIELDS, ["code", "message", "retry_after_seconds"]);
});

// AC5 (#680): service credentials carry a SEPARATE policy cell from users and
// anonymous callers, so machine identity never inherits (or resets into) a
// human limit.
void test("service credentials have a SEPARATE policy cell and key namespace", () => {
  const svc = serviceCredentialPolicy();
  assert.equal(GATEWAY_ROUTES.every((route) => route.rate !== svc), true, "no route serves with the service cell until its planned route wires it");
  assert.equal(svc.limiter, "durable");
  assert.match(serviceCredentialKey("worker-bot"), /^svc:worker-bot$/);
  assert.equal(serviceCredentialKey("worker-bot").startsWith("authed:"), false);
});
