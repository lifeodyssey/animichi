import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import type { Env } from "../src/env.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

// SUT: the API Worker's authenticated limiter, entered through the app.
//
// P2-5 (issue #284 / Task 9, round 3): the authenticated cost-path allowlist
// was an exact-match `Array.includes`, so a trailing slash on the path
// bypassed the limiter outright — "/v1/byok/probe/" counted for nothing. #479
// then found the split-brain inverse: a router that decodes `%XX` before
// matching served `/v1/%62yok/probe` as the probe, while the limiter read it as
// no BYOK path and spent nothing.
//
// Both are closed by construction now that a route's rate cell is part of the
// route itself (`src/gateway/route-table.ts`): Hono matches the raw path, and a
// request is metered by the cell of the route it matched. A trailing-slash or
// percent-encoded spelling of a route is no route at all, so it is the shared
// 404 and spends nothing (`gateway-entry-rate-class.test.ts` pins each one).
//
// #1605 removed the container forward the encoded-path cases used to ride, so
// the cases below assert the stronger end state — the encoded form is not a
// route, and the real route's window is still the identity's — instead of the
// old "shares the window" form.

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function env(guard: ReturnType<typeof fakeGuard>["namespace"]): Env {
  return {
    EDGE_GUARD: guard,
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
  } as unknown as Env;
}

function authedApp() {
  return createWorkerApp({ agentTurns: nativeAgentReceiver(),
        authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
}

const POST = { method: "POST", headers: { Authorization: "Bearer jwt" } };

void test("a real request to a percent-encoded /v1/byok/ path is not a second entrance", async () => {
  const guard = fakeGuard(NOW).namespace;
  const app = authedApp();
  const e = env(guard);
  const first = await app.request("/v1/byok/probe", POST, e, stubCtx);
  assert.equal(first.status, 200, "the plain path spends the one-request window");
  const encoded = await app.request("/v1/%62yok/probe", POST, e, stubCtx);
  assert.equal(encoded.status, 404, "the percent-encoded path is not a route the tier selects");
  const again = await app.request("/v1/byok/probe", POST, e, stubCtx);
  assert.equal(again.status, 429, "and the real route is still the identity's spent window");
});

void test("a real request to a percent-encoded /v1/chat path is not a second entrance", async () => {
  const guard = fakeGuard(NOW).namespace;
  const app = authedApp();
  const e = env(guard);
  const first = await app.request("/v1/chat", POST, e, stubCtx);
  assert.equal(first.status, 200);
  const encoded = await app.request("/v1/%63hat", POST, e, stubCtx);
  assert.equal(encoded.status, 404);
  const again = await app.request("/v1/chat", POST, e, stubCtx);
  assert.equal(again.status, 429);
});
