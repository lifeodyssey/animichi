import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { envWithContainer, stubCtx } from "../src/container/entry-env.ts";

// #1599: the two container-forward cases below probe `PATCH
// /v1/conversations/{session_id}` (the rename route). `GET /v1/conversations` is
// the edge's own conversation index now (`{ kind: "list" }` in
// `routing-policy.ts`), so it never reaches `forwardV1`; rename is still
// container-served, and `envWithContainer` binds `alwaysAllowGuard` for its
// durable limiter, leaving the forward's identity handling as the thing under test.

void test("/v1 private route -> container once the edge verified the caller", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/conversations/s-1", { method: "PATCH" }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, true, "the private /v1 branch must verify the caller itself");
});

void test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

void test("verified authentication reaches the native tier as a separate identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer({}), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0]?.identity, { userId: "u1", userType: "human" });
});

void test("client-forged identity headers cannot override the native authenticated identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "real", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged", "X-User-Type": "admin" } }, envWithContainer({}), stubCtx);
  assert.deepEqual(calls[0]?.identity, { userId: "real", userType: "human" });
  assert.equal(calls[0].request.headers.get("X-User-Id"), "forged");
});

void test("the container forward carries the edge-verified identity, never the caller's headers", async () => {
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
  });
  const cap: { req?: Request } = {};
  const headers = { Authorization: "Bearer private", "X-User-Id": "forged" };
  const res = await app.request("/v1/conversations/s-1", { method: "PATCH", headers }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.ok(cap.req);
  assert.equal(cap.req.headers.get("Authorization"), null);
  assert.equal(cap.req.headers.get("X-User-Id"), "u1", "the caller's forged id must not survive the forward");
  assert.equal(cap.req.headers.get("X-User-Type"), "human");
});

void test("/v1/users with valid auth -> USERS gets X-User identity, no Authorization", async () => {
  let authCalled = false;
  let received: Request | undefined;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const); };
  const app = createWorkerApp({ authenticate });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("users")); } },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => Promise.resolve(new Response("container")) }),
    },
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
