import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { STAGING_GATE_EXCHANGE_PATH, STAGING_GATE_SESSION_HEADER } from "../src/staging-gate/session.ts";

// #1054 — the staging-gate OIDC exchange is reachable through the composed
// edge HTTP seam at /staging-gate/exchange (the WAF passes this path ahead of
// the worker). The default wiring verifies GitHub OIDC over the remote JWKS;
// tests substitute an exchange so no network is touched while still proving
// route classification, showcase-bypass, and response shaping end-to-end.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function baseEnv() {
  return {
    EDGE_GUARD: fakeGuard(Date.now()).namespace,
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => Promise.resolve(new Response("container")) }),
    },
  } as Record<string, unknown>;
}

void test("POST /staging-gate/exchange is served by the injected exchange (reaches the worker past the WAF)", async () => {
  const app = createWorkerApp({
    stagingGateExchange: () => Promise.resolve(Response.json({ session: "sess-from-injected" }, {
      status: 200,
      headers: { [STAGING_GATE_SESSION_HEADER]: "sess-from-injected" },
    })),
  });
  const res = await app.request(STAGING_GATE_EXCHANGE_PATH, { method: "POST" }, baseEnv(), stubCtx);
  assert.equal(res.status, 200);
  const body = await res.json() as { session?: string };
  assert.equal(body.session, "sess-from-injected");
});

void test("the exchange is not blocked by the showcase gate (an auth surface, not a content route)", async () => {
  const app = createWorkerApp({
    stagingGateExchange: () => Promise.resolve(new Response("ok", { status: 200 })),
  });
  const env = { ...baseEnv(), EDGE_SHOWCASE_MODE: "true" } as never;
  const res = await app.request(STAGING_GATE_EXCHANGE_PATH, { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 200);
});