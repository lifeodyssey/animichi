import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, catalogOutbound } from "./app.ts";
import { envWithCatalog, stubCtx } from "./container/entry-env.ts";

void test("GET /healthz reaches the container, not OpenNext", async () => {
  const app = createWorkerApp({});
  let wasContainerHit = false;
  const env = {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => { wasContainerHit = true; return Promise.resolve(new Response("ok")); } }),
    },
  };
  const res = await app.request("/healthz", {}, env);
  assert.equal(wasContainerHit, true);
  assert.equal(await res.text(), "ok");
});

// The old name for this said "/catalog/* is NOT publicly routed", which was
// never true — `/catalog/public/*` IS routed (see app.ts). The property that
// matters, and the one asserted here, is narrower: a REAL private catalog
// endpoint must not be reachable from the edge and must never touch the
// CATALOG binding. `/catalog/search` is such an endpoint; the sibling case in
// gateway-fallback.test.ts uses an invented `/catalog/public/*` path, which
// exercises the explicit-deny branch instead of this one.
void test("a real private catalog endpoint is unreachable and never touches the binding", async () => {
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

void test("exact public anime overview GET forwards anonymously, no auth called", async () => {
  let wasAuthCalled = false;
  const authenticate = () => { wasAuthCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302", {}, envWithCatalog(cap), stubCtx);
  assert.equal(await res.text(), "cat");
  assert.equal(wasAuthCalled, false);
});

void test("public catalog forwarding keeps only the minimal safe header allowlist", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const headers = {
    Accept: "application/json", Authorization: "Bearer test-token-000",
    Cookie: "session=test-token-000", "X-API-Key": "test-token-000",
    "X-User-Id": "forged",
  };
  await app.request("/catalog/public/anime-overview/3302", { headers }, envWithCatalog(cap), stubCtx);
  assert.ok(cap.req);
  assert.deepEqual([...cap.req.headers], [["accept", "application/json"]]);
});

void test("public anime overview rejects unexpected query parameters", async () => {
  const app = createWorkerApp({});
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302?nonce=fixed", {}, envWithCatalog(cap), stubCtx);
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

void test("catalogOutbound forwards container requests to the CATALOG binding", async () => {
  let hasReceived: Request | null = null;
  const env = { CATALOG: { fetch: (req: Request) => { hasReceived = req; return Promise.resolve(new Response("cat")); } } };
  const req = new Request("http://catalog.internal/catalog/search", { method: "POST" });
  const res = await catalogOutbound(req, env as never);
  assert.equal(await res.text(), "cat");
  assert.equal(hasReceived, req);
});

void test("/img/* routes to the image proxy (bad path → 400, not OpenNext)", async () => {
  const app = createWorkerApp({});
  // "a..b" survives URL normalization (dots not adjacent to slashes) and trips
  // handleImageProxy's ".." guard → 400, proving the request reached the image
  // handler rather than falling through to OpenNext (which would return "next").
  const res = await app.request("/img/a..b", {}, {}, stubCtx);
  assert.equal(res.status, 400);
  assert.notEqual(await res.text(), "next");
});
