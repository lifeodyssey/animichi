import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, catalogOutbound } from "./app.ts";

const stubNext = {
  fetch: async () => new Response("next", { status: 200 }),
};

const stubCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

test("GET /healthz reaches the container, not OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  let containerHit = false;
  const env = {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: async () => { containerHit = true; return new Response("ok"); } }),
    },
  };
  const res = await app.request("/healthz", {}, env);
  assert.equal(containerHit, true);
  assert.equal(await res.text(), "ok");
});

test("/catalog/* is NOT publicly routed (falls through to OpenNext)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  const res = await app.request("/catalog/search", { method: "POST" }, {}, stubCtx);
  assert.equal(await res.text(), "next"); // hits OpenNext (404-able), never env.CATALOG
});

test("unknown path falls through to OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  const res = await app.request("/anything", {}, {}, stubCtx);
  assert.equal(await res.text(), "next");
});

test("catalogOutbound forwards container requests to the CATALOG binding", async () => {
  let received: Request | null = null;
  const env = { CATALOG: { fetch: async (req: Request) => { received = req; return new Response("cat"); } } };
  const req = new Request("http://catalog.internal/catalog/search", { method: "POST" });
  const res = await catalogOutbound(req, env as never);
  assert.equal(await res.text(), "cat");
  assert.equal(received, req);
});

test("/img/* routes to the image proxy (bad path → 400, not OpenNext)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  // "a..b" survives URL normalization (dots not adjacent to slashes) and trips
  // handleImageProxy's ".." guard → 400, proving the request reached the image
  // handler rather than falling through to OpenNext (which would return "next").
  const res = await app.request("/img/a..b", {}, {}, stubCtx);
  assert.equal(res.status, 400);
  assert.notEqual(await res.text(), "next");
});

function envWithContainer(captured: { req?: Request }) {
  return {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: async (r: Request) => { captured.req = r; return new Response("container"); } }),
    },
  } as never;
}

test("/v1 public route -> container, no auth called", async () => {
  let authCalled = false;
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => { authCalled = true; return { ok: false }; } });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/popular", {}, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
});

test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: false }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

test("/v1 authed route with valid creds -> container gets X-User, no Authorization", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: true, userId: "u1", userType: "human" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "u1");
  assert.equal(cap.req?.headers.get("X-User-Type"), "human");
  assert.equal(cap.req?.headers.get("Authorization"), null);
});

test("client-forged X-User-Id is stripped on authed route (worker value wins)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: true, userId: "real", userType: "human" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "real");
});

test("client-forged X-User-Id is stripped on PUBLIC route too", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: false }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/bangumi/popular", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});
