import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";
import { durableBurstCheck, stepWindow } from "../src/protect/rate-limiter.ts";

// AC6 (#680): burst/refill, concurrent atomicity, identity isolation, multi-PoP
// semantics, and failure injection are covered with CONTROLLED CLOCKS. The
// Windows runtime never sleeps; every clock is injected.

const T0 = 1_700_000_000_000;

// ── burst / refill on the durable window (controlled clock) ────────────────

void test("burst is limited and REFILLS when the window expires (injected clock)", () => {
  const config = { limit: 2, windowSeconds: 5 };
  const first = stepWindow(null, T0, config);
  const second = stepWindow(first.next, T0 + 1_000, config);
  const third = stepWindow(second.next, T0 + 2_000, config);
  assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
  const afterRefill = stepWindow(third.next, T0 + 6_000, config);
  assert.equal(afterRefill.allowed, true, "a fresh window must refill the burst allowance");
});

// ── concurrent atomicity (AC6): the guarantee is the DO single-shard,
// single-key read-modify-write. We pin the MECHANISM: each identity check is
// exactly one fetch to that identity's own shard (the transaction boundary the
// Durable Object serializes). A JS double cannot reproduce DO storage atomicity,
// so asserting the shard-count wiring is the honest observable here.

void test("durable check is exactly one shard transaction per identity (atomicity seam)", async () => {
  let fetches = 0;
  const shard = {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => { fetches += 1; return { fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))) }; },
  };
  const result = await durableBurstCheck(shard, "authed:u1", { limit: 2, windowSeconds: 60 });
  assert.equal(result.kind, "allowed");
  assert.equal(fetches, 1, "one check = one shard access (the DO serialization boundary)");
});


function nativeDouble() {
  const counts = new Map<string, number>();
  return {
    counts,
    binding: { limit: ({ key }: { key: string }) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve({ success: n <= 1 });
    } },
  };
}

function nativeEnv(binding: unknown) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: { idFromName: (name: string) => name as unknown as DurableObjectId, get: () => ({ fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))) }) },
    RATE_LIMITER: binding,
    CATALOG: { fetch: () => Promise.resolve(new Response("cat")) },
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as never;
}

void test("native tier isolates by connecting IP (two IPs never share allowance)", async () => {
  const d = nativeDouble();
  const env = nativeEnv(d.binding);
  const app = createWorkerApp({});
  const ipA = { headers: { "CF-Connecting-IP": "203.0.113.1" } };
  const ipB = { headers: { "CF-Connecting-IP": "203.0.113.2" } };
  await app.request("/v1/search/preview?q=a", ipA, env, stubCtx);
  const second = await app.request("/v1/search/preview?q=b", ipB, env, stubCtx);
  const denied = await app.request("/v1/search/preview?q=a", ipA, env, stubCtx);
  assert.equal(second.status, 200, "a different IP is not limited");
  assert.equal(denied.status, 429, "reusing the same IP beyond its slot is limited");
});

// ── multi-PoP semantics: one shared binding across isolates ─────────────────

void test("multi-PoP: two app isolates sharing one native binding see one counter", async () => {
  // A per-isolate LOCAL limiter would let the second isolate reset the count.
  // The shared binding (the CF-native ratelimit primitive) is the guarantee:
  // both isolates spend against the SAME counter, so the second can never
  // bypass the first isolate's already-consumed burst slot.
  const d = nativeDouble();
  const appA = createWorkerApp({});
  const appB = createWorkerApp({});
  const env = nativeEnv(d.binding);
  const first = await appA.request("/v1/search/preview?q=x", {}, env, stubCtx);
  const second = await appB.request("/v1/search/preview?q=x", {}, env, stubCtx);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429, "PoP B must see PoP A's spent slot (no per-isolate reset)");
});

// ── failure injection at the enforcement seam ───────────────────────────────

void test("failure injection: an anonymous chat turn fails closed on durable outage", async () => {
  const down = { idFromName: (n: string) => n as unknown as DurableObjectId, get: () => ({ fetch: () => Promise.reject(new Error("down")) }) };
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: down,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as never;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }), turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) } });
  const res = await app.request("/v1/chat", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 503, "an anonymous chat in the high-cost class fails closed on a limiter outage");
});
