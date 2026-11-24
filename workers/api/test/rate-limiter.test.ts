import test from "node:test";
import assert from "node:assert/strict";
import { memoryGuardStore } from "../src/protect/guard-store.ts";
import {
  authenticatedRateLimitKey,
  authRateLimitConfigFrom,
  checkRateLimit,
  consumeRateLimit,
  parseWindowState,
  rateLimitConfigFrom,
  type RateLimitConfig,
  stepWindow,
} from "../src/protect/rate-limiter.ts";

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

void test("a rejected request skips the storage write (P2-3: no write amplification)", async () => {
  let puts = 0;
  const store = {
    get: () => Promise.resolve({ startedAtMs: T0, count: 1 }),
    put: () => { puts += 1; return Promise.resolve(); },
  };
  const decision = await consumeRateLimit(store, T0 + 1, { limit: 1, windowSeconds: 30 });
  assert.equal(decision.allowed, false);
  assert.equal(puts, 0, "a rejected request must not write an unchanged window back to storage");
});

void test("checkRateLimit fails open when the shard's fetch promise rejects", async () => {
  const guard = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: () => Promise.reject(new Error("connection lost")) }),
  } as never;
  const decision = await checkRateLimit(guard, "user-a", CONFIG);
  assert.equal(decision, null);
});

void test("checkRateLimit fails open when the shard answers 200 with a non-JSON body", async () => {
  const guard = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: () => Promise.resolve(new Response("not json", { status: 200 })) }),
  } as never;
  const decision = await checkRateLimit(guard, "user-a", CONFIG);
  assert.equal(decision, null);
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

void test("authenticated limiter config falls back to the authenticated class default (60/60, not 20/60)", () => {
  // AUTH-1 #945: the fallback comes from the IdentityPolicy's authenticated
  // class, which deliberately differs from the anonymous class's 20/60.
  assert.deepEqual(authRateLimitConfigFrom({}), { limit: 60, windowSeconds: 60 });
});

// ── the window bound: the reclaim alarm, two windows out, stays inside the Date range ──

/** 10^306 seconds, written out in the 307 digits an env var would hold: finite, and far past the bound. */
const OVERLONG_WINDOW = "1".padEnd(307, "0");

type ConfigReader = (env: Record<string, unknown>) => RateLimitConfig;

const WINDOW_BOUND: readonly (readonly [says: string, read: ConfigReader, env: Record<string, string>, config: RateLimitConfig])[] = [
  ["the anonymous config reads the longest window, 4e12 s, as written", rateLimitConfigFrom,
    { ANON_RATE_LIMIT_WINDOW_SECONDS: "4000000000000" }, { limit: 20, windowSeconds: 4_000_000_000_000 }],
  ["the anonymous config takes the default for a window one second longer", rateLimitConfigFrom,
    { ANON_RATE_LIMIT_WINDOW_SECONDS: "4000000000001" }, { limit: 20, windowSeconds: 60 }],
  ["the anonymous config takes the default for a 307-digit window", rateLimitConfigFrom,
    { ANON_RATE_LIMIT_WINDOW_SECONDS: OVERLONG_WINDOW }, { limit: 20, windowSeconds: 60 }],
  ["the authenticated config reads the longest window, 4e12 s, as written", authRateLimitConfigFrom,
    { AUTH_RATE_LIMIT_WINDOW_SECONDS: "4000000000000" }, { limit: 60, windowSeconds: 4_000_000_000_000 }],
  ["the authenticated config takes the default for a window one second longer", authRateLimitConfigFrom,
    { AUTH_RATE_LIMIT_WINDOW_SECONDS: "4000000000001" }, { limit: 60, windowSeconds: 60 }],
  ["the authenticated config takes the default for a 307-digit window", authRateLimitConfigFrom,
    { AUTH_RATE_LIMIT_WINDOW_SECONDS: OVERLONG_WINDOW }, { limit: 60, windowSeconds: 60 }],
];

for (const [says, read, env, config] of WINDOW_BOUND) {
  void test(says, () => {
    assert.deepEqual(read(env), config);
  });
}

void test("the authenticated key is derived from the user id alone", () => {
  assert.equal(authenticatedRateLimitKey("user-a"), "authed:user-a");
  assert.equal(authenticatedRateLimitKey("user-b"), "authed:user-b");
});

void test("the authenticated key never collides with the anon_-prefixed anonymous namespace", () => {
  assert.notEqual(authenticatedRateLimitKey("anon_deadbeef"), "anon_deadbeef");
  assert.match(authenticatedRateLimitKey("anon_deadbeef"), /^authed:/);
});
