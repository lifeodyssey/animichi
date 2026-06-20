// Routing-branch test for the main Worker.
//
// Runs under the Node built-in test runner (`node --test`) — no extra deps and
// no need for the OpenNext build artifact, because the routing decision lives in
// the dependency-free worker/router.js. Two layers:
//   1. routeKindFor: the pure pathname -> kind classification.
//   2. dispatch shape: a stubbed env (CATALOG service binding, ASSETS-backed
//      OpenNext handler, CONTAINER) proving each kind reaches the right target.
import test from "node:test";
import assert from "node:assert/strict";
import { routeKindFor } from "./router.js";

test("routeKindFor classifies /catalog/* to the catalog binding", () => {
  assert.equal(routeKindFor("/catalog/nearby"), "catalog");
  assert.equal(routeKindFor("/catalog/search"), "catalog");
  assert.equal(routeKindFor("/catalog"), "catalog");
});

test("routeKindFor sends /v1/* through to OpenNext (next), not catalog", () => {
  assert.equal(routeKindFor("/v1/runtime"), "next");
  assert.equal(routeKindFor("/v1/runtime/stream"), "next");
});

test("routeKindFor classifies healthz, images, and static fallthrough", () => {
  assert.equal(routeKindFor("/healthz"), "healthz");
  assert.equal(routeKindFor("/img/foo.jpg"), "image");
  assert.equal(routeKindFor("/chat"), "next");
  assert.equal(routeKindFor("/"), "next");
});

// --- dispatch shape: a minimal re-implementation of entry.js's branch table,
// proving each kind lands on the intended env target. We rebuild the dispatch
// here (rather than import entry.js) because entry.js imports the OpenNext build
// artifact that does not exist at unit-test time. The branch order mirrors
// entry.js exactly so a divergence here is a visible signal to update both.
async function dispatch(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const kind = routeKindFor(pathname);
  if (kind === "healthz") {
    return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(request);
  }
  if (kind === "image") return new Response("image", { status: 200 });
  if (kind === "catalog") return env.CATALOG.fetch(request);
  return env.__NEXT.fetch(request, env, ctx);
}

function makeEnv() {
  const calls = { catalog: 0, next: 0, container: 0 };
  const container = {
    idFromName: () => "id",
    get: () => ({
      fetch: () => {
        calls.container++;
        return new Response("container", { status: 200 });
      },
    }),
  };
  return {
    calls,
    CATALOG: {
      fetch: () => {
        calls.catalog++;
        return new Response("catalog", { status: 200 });
      },
    },
    CONTAINER: container,
    __NEXT: {
      fetch: () => {
        calls.next++;
        return new Response("next", { status: 200 });
      },
    },
  };
}

test("dispatch: /catalog/x -> CATALOG.fetch", async () => {
  const env = makeEnv();
  const res = await dispatch(new Request("https://x.dev/catalog/nearby"), env, {});
  assert.equal(await res.text(), "catalog");
  assert.equal(env.calls.catalog, 1);
  assert.equal(env.calls.next, 0);
});

test("dispatch: /v1/x -> OpenNext (which proxies to container)", async () => {
  const env = makeEnv();
  const res = await dispatch(new Request("https://x.dev/v1/runtime"), env, {});
  assert.equal(await res.text(), "next");
  assert.equal(env.calls.next, 1);
  assert.equal(env.calls.catalog, 0);
});

test("dispatch: /healthz -> CONTAINER", async () => {
  const env = makeEnv();
  const res = await dispatch(new Request("https://x.dev/healthz"), env, {});
  assert.equal(await res.text(), "container");
  assert.equal(env.calls.container, 1);
});

test("dispatch: /chat -> OpenNext (ASSETS-backed static)", async () => {
  const env = makeEnv();
  const res = await dispatch(new Request("https://x.dev/chat"), env, {});
  assert.equal(await res.text(), "next");
  assert.equal(env.calls.next, 1);
  assert.equal(env.calls.catalog, 0);
});
