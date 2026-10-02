import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { stubCtx } from "./doubles/entry-env.ts";

// Showcase-mode retirement (#1975): the edge has no showcase gate. With the
// environment production's own wrangler ring sets (APP_ENV, anonymous access
// off, and NO showcase variable — it does not exist any more), a functional
// /v1 request and the public catalog read reach their handlers, and no
// response carries the `showcase_denied` denial. Restoring the gate (a
// fail-closed 403 ahead of these handlers) turns every case here red.

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const SECRET = "fixed-test-hmac-key-0000000000000000";

/** Production-shaped: the vars production's `[env.production.vars]` sets and
 * the bindings a request needs. No showcase key — the variable is retired. */
function productionEnv(catalog: { req?: Request }) {
  return {
    APP_ENV: "production",
    ANON_ACCESS_ENABLED: "false",
    ANON_ID_SECRET: SECRET,
    CATALOG: { fetch: (req: Request) => { catalog.req = req; return Promise.resolve(new Response("catalog")); } },
    EDGE_GUARD: fakeGuard(NOW).namespace,
  } as never;
}

void test("a production-shaped environment serves the functional /v1 surface", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
    agentTurns: nativeAgentReceiver(calls),
  });
  const res = await app.request(
    "/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } },
    productionEnv({}), stubCtx,
  );
  assert.equal(res.status, 200);
  assert.notEqual(res.status, 403);
  assert.equal(calls.length, 1, "the request reached the native tier");
  assert.notEqual(String((await res.clone().json().catch(() => ({})) as { error?: { code?: string } }).error?.code),
    "showcase_denied", "no response may carry the retired showcase denial");
});

void test("a production-shaped environment serves the public catalog read", async () => {
  const captured: { req?: Request } = {};
  const app = createWorkerApp({});
  const res = await app.request("/catalog/public/popular", {}, productionEnv(captured), stubCtx);
  assert.equal(res.status, 200);
  assert.notEqual(res.status, 403);
  assert.ok(captured.req, "the read was forwarded to the catalog binding");
  assert.notEqual(String((await res.clone().json().catch(() => ({})) as { error?: { code?: string } }).error?.code),
    "showcase_denied", "no response may carry the retired showcase denial");
});
