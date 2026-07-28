import test from "node:test";
import assert from "node:assert/strict";
import { memoryGuardStore } from "./guardStore.ts";
import {
  authenticatedRateLimitKey,
  authRateLimitConfigFrom,
  consumeRateLimit,
  parseWindowState,
  rateLimitConfigFrom,
  stepWindow,
} from "./rateLimiter.ts";

// The clock is always injected — no test here sleeps or reads the real time.
const CONFIG = { limit: 3, windowSeconds: 60 };
const T0 = 1_700_000_000_000;

void test("a brand-new identity with zero history is allowed immediately", () => {
  const decision = stepWindow(null, T0, CONFIG);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.next, { startedAtMs: T0, count: 1 });
});

void test("requests up to the configured limit are allowed", () => {
  const first = stepWindow(null, T0, CONFIG);
  const second = stepWindow(first.next, T0 + 1_000, CONFIG);
  const third = stepWindow(second.next, T0 + 2_000, CONFIG);
  assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, true]);
  assert.equal(third.next.count, 3);
});

void test("the request past the limit is rejected with a retry hint", () => {
  const third = { startedAtMs: T0, count: 3 };
  const decision = stepWindow(third, T0 + 10_000, CONFIG);
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterSeconds, 50);
});

void test("a rejected request does not extend the window (no punitive lockout)", () => {
  const full = { startedAtMs: T0, count: 3 };
  const decision = stepWindow(full, T0 + 10_000, CONFIG);
  assert.deepEqual(decision.next, full);
});

void test("the window resets once it expires on the mocked clock", () => {
  const full = { startedAtMs: T0, count: 3 };
  const decision = stepWindow(full, T0 + 60_000, CONFIG);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.next, { startedAtMs: T0 + 60_000, count: 1 });
});

void test("one millisecond before expiry the window still applies", () => {
  const decision = stepWindow({ startedAtMs: T0, count: 3 }, T0 + 59_999, CONFIG);
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterSeconds, 1);
});

void test("consumeRateLimit persists the window across calls", async () => {
  const store = memoryGuardStore();
  const config = { limit: 1, windowSeconds: 30 };
  const first = await consumeRateLimit(store, T0, config);
  const second = await consumeRateLimit(store, T0 + 1_000, config);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

void test("consumeRateLimit lets the identity through again after the window", async () => {
  const store = memoryGuardStore();
  const config = { limit: 1, windowSeconds: 30 };
  await consumeRateLimit(store, T0, config);
  const later = await consumeRateLimit(store, T0 + 30_000, config);
  assert.equal(later.allowed, true);
});

void test("a corrupt stored window is treated as no window, not a crash", () => {
  assert.equal(parseWindowState("nonsense"), null);
  assert.equal(parseWindowState({ startedAtMs: "x", count: 1 }), null);
  assert.deepEqual(parseWindowState({ startedAtMs: 1, count: 2 }), { startedAtMs: 1, count: 2 });
});

void test("limiter config comes from env, with safe defaults", () => {
  assert.deepEqual(rateLimitConfigFrom({}), { limit: 20, windowSeconds: 60 });
  assert.deepEqual(
    rateLimitConfigFrom({ ANON_RATE_LIMIT: "5", ANON_RATE_LIMIT_WINDOW_SECONDS: "10" }),
    { limit: 5, windowSeconds: 10 },
  );
});

void test("non-numeric or non-positive limiter config falls back to the defaults", () => {
  assert.deepEqual(
    rateLimitConfigFrom({ ANON_RATE_LIMIT: "0", ANON_RATE_LIMIT_WINDOW_SECONDS: "abc" }),
    { limit: 20, windowSeconds: 60 },
  );
});

// ── authenticated-path limiter (issue #284 / Task 9) ────────────────────────

void test("the authenticated limiter's config is independent of the anonymous one", () => {
  assert.deepEqual(
    authRateLimitConfigFrom({ ANON_RATE_LIMIT: "5", AUTH_RATE_LIMIT: "9", AUTH_RATE_LIMIT_WINDOW_SECONDS: "30" }),
    { limit: 9, windowSeconds: 30 },
  );
});

void test("authenticated limiter config falls back to the shared defaults", () => {
  assert.deepEqual(authRateLimitConfigFrom({}), { limit: 20, windowSeconds: 60 });
});

void test("the authenticated key is derived from the user id alone", () => {
  assert.equal(authenticatedRateLimitKey("user-a"), "authed:user-a");
  assert.equal(authenticatedRateLimitKey("user-b"), "authed:user-b");
});

void test("the authenticated key never collides with the anon_-prefixed anonymous namespace", () => {
  assert.notEqual(authenticatedRateLimitKey("anon_deadbeef"), "anon_deadbeef");
  assert.match(authenticatedRateLimitKey("anon_deadbeef"), /^authed:/);
});
