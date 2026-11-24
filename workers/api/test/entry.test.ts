import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { envWithCatalog, stubCtx } from "./doubles/entry-env.ts";

// #1596: the readiness probe is the edge's own answer. Its Env carries no
// binding to wake — and since #1605 there is no container binding anywhere — so
// a deploy whose agent runtime is unreachable still reports a healthy gateway.
void test("GET /healthz is answered by the edge alone", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/healthz", {}, {}, stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

// The old name for this said "/catalog/* is NOT publicly routed", which was
// never true — `/catalog/public/*` IS routed (see app.ts). The property that
// matters, and the one asserted here, is narrower: a private catalog path
// must not be reachable from the edge and must never touch the CATALOG
// binding. `/catalog/search` was a real private endpoint until #2075 retired
// it, and no route reaches it any more than the live private procedures
// (`/catalog/resolve` and the rest); the sibling case in
// gateway-fallback.test.ts uses an undeclared `/catalog/public/*` path.
void test("a private catalog path is unreachable and never touches the binding", async () => {
  const app = createWorkerApp({});
  let wasCatalogHit = false;
  const env = { CATALOG: { fetch: () => { wasCatalogHit = true; return Promise.resolve(new Response("cat")); } } } as never;
  const res = await app.request("/catalog/search", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(wasCatalogHit, false); // security: the binding stays private
});

// The web's route page asks for its itinerary with the contract's `planItinerary`
// (`apps/web/src/features/route-detail/hooks.ts`): a POST of `{ point_ids }` to
// `/catalog/itinerary` on the edge origin. That procedure is private, a live one
// unlike `/catalog/search` above, and no gateway route serves it, so the request
// is the shared 404 and the CATALOG binding never sees it. Showcase mode is off,
// so a route that forwarded it would reach the binding and be seen here.
void test("the itinerary the web posts is unreachable and never touches the binding", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const body = JSON.stringify({ point_ids: ["point-a", "point-b"] });
  const init = { method: "POST", headers: { "content-type": "application/json" }, body };
  const res = await app.request("/catalog/itinerary", init, envWithCatalog(cap), stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(cap.req, undefined); // security: the binding stays private
});

void test("exact public anime overview GET forwards anonymously, no auth called", async () => {
  let wasAuthCalled = false;
  const authenticate = () => { wasAuthCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302", {}, envWithCatalog(cap), stubCtx);
  assert.equal(await res.text(), "cat");
  assert.equal(wasAuthCalled, false);
});

void test("public catalog forwarding keeps only the minimal safe header allowlist and the gateway's request ID", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const headers = {
    Accept: "application/json", Authorization: "Bearer test-token-000",
    Cookie: "session=test-token-000", "X-API-Key": "test-token-000",
    "X-User-Id": "forged", "X-Request-Id": "forged",
  };
  const res = await app.request("/catalog/public/anime-overview/3302", { headers }, envWithCatalog(cap), stubCtx);
  assert.ok(cap.req);
  assert.deepEqual([...cap.req.headers], [["accept", "application/json"], ["x-request-id", res.headers.get("X-Request-Id")]]);
});

void test("public anime overview rejects unexpected query parameters", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302?nonce=fixed", {}, envWithCatalog(cap), stubCtx);
  assert.equal(res.status, 400);
  assert.equal(cap.req, undefined);
});

void test("the popularity ranking forwards anonymously with its declared limit", async () => {
  let wasAuthCalled = false;
  const authenticate = () => { wasAuthCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/popular?limit=4", {}, envWithCatalog(cap), stubCtx);
  assert.equal(await res.text(), "cat");
  assert.equal(wasAuthCalled, false);
  assert.ok(cap.req);
  // The declared parameter must reach the CATALOG binding untouched: the cache
  // key is the request URL, so a dropped `limit=4` would serve the 8-item
  // default to a caller that asked for four.
  assert.equal(new URL(cap.req.url).search, "?limit=4");
});

void test("the popularity ranking rejects an undeclared query parameter", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/popular?spoof=1", {}, envWithCatalog(cap), stubCtx);
  assert.equal(res.status, 400);
  assert.equal(cap.req, undefined);
});

async function assertPublicCatalogRejected(path: string, method = "GET"): Promise<void> {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const res = await app.request(path, { method }, envWithCatalog(cap), stubCtx);
  assert.equal(res.status, 404);
  assert.equal(cap.req, undefined);
}

void test("encoded path separator cannot extend the public route", () =>
  assertPublicCatalogRejected("/catalog/public/anime-overview/3302%2Fsecret"));

void test("dot-segment traversal cannot escape the exact public route", () =>
  assertPublicCatalogRejected("/catalog/public/anime-overview/3302/../secret"));

void test("sibling public path cannot bypass the exact route", () =>
  assertPublicCatalogRejected("/catalog/public/anime-overviews/3302"));

void test("POST cannot invoke the public anime overview", () =>
  assertPublicCatalogRejected("/catalog/public/anime-overview/3302", "POST"));

void test("PUT cannot invoke the public anime overview", () =>
  assertPublicCatalogRejected("/catalog/public/anime-overview/3302", "PUT"));

// (The old "unknown path falls through to OpenNext" case lived here. It is now
// covered twice over by gateway-fallback.test.ts — `/` and `/some/legacy/page`
// both assert the 404 status and the shared error envelope — so it was removed
// rather than restated. Checked before deleting: the property survives.)

void test("/img/* routes to the image proxy (bad path → 400, not OpenNext)", async () => {
  const app = createWorkerApp({});
  // "a..b" survives URL normalization (dots not adjacent to slashes) and trips
  // handleImageProxy's ".." guard → 400, proving the request reached the image
  // handler rather than falling through to OpenNext (which would return "next").
  const res = await app.request("/img/a..b", {}, {}, stubCtx);
  assert.equal(res.status, 400);
  assert.notEqual(await res.text(), "next");
});
