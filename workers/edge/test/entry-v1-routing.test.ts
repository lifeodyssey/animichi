import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { gatewayEnv, stubCtx } from "./doubles/entry-env.ts";

// #1604 deleted the photo search surface, which was the last container-forwarded `/v1`
// route; #1605 then deleted `forwardV1`, the `CONTAINER` binding and the class
// behind it. Every `/v1` route that survives is answered by this Worker: either
// selected by `turnRoutePolicy` for the native tier or 404 in the shared
// envelope. What this file keeps is the identity wall both remaining receivers
// still share: the edge verifies the caller itself, and a forged header never
// survives to the far side.

void test("/v1 authed route without creds -> 401", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const res = await app.request("/v1/chat", { method: "POST" }, gatewayEnv(), stubCtx);
  assert.equal(res.status, 401);
});

void test("verified authentication reaches the native tier as a separate identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, gatewayEnv(), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0]?.identity, { userId: "u1", userType: "human" });
});

void test("client-forged identity headers cannot override the native authenticated identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "real", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged", "X-User-Type": "admin" } }, gatewayEnv(), stubCtx);
  assert.deepEqual(calls[0]?.identity, { userId: "real", userType: "human" });
  assert.equal(calls[0].request.headers.get("X-User-Id"), "forged");
});

void test("/v1/users with valid auth -> USERS gets X-User identity, no Authorization", async () => {
  let authCalled = false;
  let received: Request | undefined;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const); };
  const app = createWorkerApp({ authenticate });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", {
    headers: { Authorization: "Bearer x", "X-User-Id": "forged" },
  }, env, stubCtx);
  assert.equal(await res.text(), "users");
  assert.equal(authCalled, true, "the edge must verify the users bearer itself");
  assert.ok(received);
  assert.equal(received.headers.get("X-User-Id"), "u1");
  assert.equal(received.headers.get("X-User-Type"), "human");
  assert.equal(received.headers.get("Authorization"), null, "raw bearer must never reach the users service");
});

void test("/v1/users with an invalid credential 401s without hitting USERS", async () => {
  let received = false;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "invalid" }) });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", { headers: { Authorization: "Bearer bad" } }, env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(received, false);
});

void test("/v1/users with no credential 401s — anonymous is never allowed on users", async () => {
  let received = false;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", {}, env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(received, false);
});
