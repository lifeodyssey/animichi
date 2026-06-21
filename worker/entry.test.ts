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
