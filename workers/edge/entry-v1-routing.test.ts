import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import { envWithContainer, stubCtx } from "./container/entry-env.ts";

void test("/v1 public route -> container, no auth called", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/popular", {}, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
});

void test("/v1 guide route (regex) is public -> container, no auth, client X-User stripped", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/12345/guide", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});

void test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

void test("/v1 authed route with valid creds -> container gets X-User, no Authorization", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer(cap), stubCtx);
  assert.ok(cap.req);
  assert.equal(cap.req.headers.get("X-User-Id"), "u1");
  assert.equal(cap.req.headers.get("X-User-Type"), "human");
  assert.equal(cap.req.headers.get("Authorization"), null);
});

void test("client-forged X-User-Id is stripped on authed route (worker value wins)", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "real", userType: "human" } as const);
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "real");
});

void test("client-forged X-User-Id is stripped on PUBLIC route too", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/bangumi/popular", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});

void test("/v1/users/saved-routes -> USERS with Authorization intact, no container or auth", async () => {
  let authCalled = false;
  let containerHit = false;
  let received: Request | undefined;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("users")); } },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => { containerHit = true; return Promise.resolve(new Response("container")); } }),
    },
  } as never;
  const res = await app.request("/v1/users/saved-routes", { headers: { Authorization: "Bearer x" } }, env, stubCtx);
  assert.equal(await res.text(), "users");
  assert.equal(received?.headers.get("Authorization"), "Bearer x");
  assert.equal(containerHit, false);
  assert.equal(authCalled, false);
});

void test("/v1/users/saved-routes bypasses a rejecting authenticate stub", async () => {
  let received = false;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", {}, env, stubCtx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "users");
  assert.equal(received, true);
});
