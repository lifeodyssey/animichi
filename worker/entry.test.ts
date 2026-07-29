import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWorkerApp, catalogOutbound } from "./app.ts";
import { buildContainerEnvVars } from "./containerEnv.ts";

const stubNext = {
  fetch: () => Promise.resolve(new Response("next", { status: 200 })),
};

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

void test("GET /healthz reaches the container, not OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  let containerHit = false;
  const env = {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => { containerHit = true; return Promise.resolve(new Response("ok")); } }),
    },
  };
  const res = await app.request("/healthz", {}, env);
  assert.equal(containerHit, true);
  assert.equal(await res.text(), "ok");
});

void test("/catalog/* is NOT publicly routed (falls through to OpenNext)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  let catalogHit = false;
  const env = { CATALOG: { fetch: () => { catalogHit = true; return Promise.resolve(new Response("cat")); } } } as never;
  const res = await app.request("/catalog/search", { method: "POST" }, env, stubCtx);
  assert.equal(await res.text(), "next"); // hits OpenNext (404-able), never env.CATALOG
  assert.equal(catalogHit, false); // security: non-allowlisted catalog path stays private
});

function envWithCatalog(captured: { req?: Request }) {
  return {
    CATALOG: { fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response("cat")); } },
  } as never;
}

void test("exact public anime overview GET forwards anonymously, no auth called", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302", {}, envWithCatalog(cap), stubCtx);
  assert.equal(await res.text(), "cat");
  assert.equal(authCalled, false);
});

void test("public catalog forwarding keeps only the minimal safe header allowlist", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
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
  const app = createWorkerApp({ nextHandler: stubNext });
  const cap: { req?: Request } = {};
  const res = await app.request("/catalog/public/anime-overview/3302?nonce=fixed", {}, envWithCatalog(cap), stubCtx);
  assert.equal(res.status, 400);
  assert.equal(cap.req, undefined);
});

async function assertPublicCatalogRejected(path: string, method = "GET"): Promise<void> {
  const app = createWorkerApp({ nextHandler: stubNext });
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

void test("unknown path falls through to OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  const res = await app.request("/anything", {}, {}, stubCtx);
  assert.equal(await res.text(), "next");
});

void test("catalogOutbound forwards container requests to the CATALOG binding", async () => {
  let received: Request | null = null;
  const env = { CATALOG: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("cat")); } } };
  const req = new Request("http://catalog.internal/catalog/search", { method: "POST" });
  const res = await catalogOutbound(req, env as never);
  assert.equal(await res.text(), "cat");
  assert.equal(received, req);
});

void test("/img/* routes to the image proxy (bad path → 400, not OpenNext)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  // "a..b" survives URL normalization (dots not adjacent to slashes) and trips
  // handleImageProxy's ".." guard → 400, proving the request reached the image
  // handler rather than falling through to OpenNext (which would return "next").
  const res = await app.request("/img/a..b", {}, {}, stubCtx);
  assert.equal(res.status, 400);
  assert.notEqual(await res.text(), "next");
});

/** An EDGE_GUARD stand-in that always allows — these tests exercise routing
 * and header handling, not the limiter itself (see byok.test.ts / Task 9). */
const alwaysAllowGuard = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: () =>
      Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
  }),
};

function envWithContainer(captured: { req?: Request }) {
  return {
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response("container")); } }),
    },
  } as never;
}

void test("/v1 public route -> container, no auth called", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/popular", {}, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
});

void test("/v1 guide route (regex) is public -> container, no auth, client X-User stripped", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/12345/guide", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});

void test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

void test("/v1 authed route with valid creds -> container gets X-User, no Authorization", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer(cap), stubCtx);
  assert.ok(cap.req);
  assert.equal(cap.req.headers.get("X-User-Id"), "u1");
  assert.equal(cap.req.headers.get("X-User-Type"), "human");
  assert.equal(cap.req.headers.get("Authorization"), null);
});

void test("client-forged X-User-Id is stripped on authed route (worker value wins)", async () => {
  const authenticate = () => Promise.resolve({ ok: true, userId: "real", userType: "human" } as const);
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "real");
});

void test("client-forged X-User-Id is stripped on PUBLIC route too", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/bangumi/popular", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});

void test("/v1/users/routes -> USERS with Authorization intact, no container or auth", async () => {
  let authCalled = false;
  let containerHit = false;
  let received: Request | undefined;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ nextHandler: stubNext, authenticate });
  const env = {
    USERS: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("users")); } },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => { containerHit = true; return Promise.resolve(new Response("container")); } }),
    },
  } as never;
  const res = await app.request("/v1/users/routes", { headers: { Authorization: "Bearer x" } }, env, stubCtx);
  assert.equal(await res.text(), "users");
  assert.equal(received?.headers.get("Authorization"), "Bearer x");
  assert.equal(containerHit, false);
  assert.equal(authCalled, false);
});

void test("/v1/users/routes bypasses a rejecting authenticate stub", async () => {
  let received = false;
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const env = {
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/routes", {}, env, stubCtx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "users");
  assert.equal(received, true);
});

function requiredEnv(): Record<string, string> {
  return { DEEPSEEK_API_KEY: "k", MIMO_API_KEY: "k", SUPABASE_DB_URL: "postgres://x" };
}

void test("ANON_DAILY_MESSAGE_QUOTA reaches the container (issue #282) — wrangler.toml alone is not the whole contract", () => {
  const envVars = buildContainerEnvVars({ ...requiredEnv(), ANON_DAILY_MESSAGE_QUOTA: "20" });
  assert.equal(envVars.ANON_DAILY_MESSAGE_QUOTA, "20");
});

void test("an unset ANON_DAILY_MESSAGE_QUOTA is simply absent, not forwarded as an empty string", () => {
  const envVars = buildContainerEnvVars(requiredEnv());
  assert.equal("ANON_DAILY_MESSAGE_QUOTA" in envVars, false);
});

// #284 Task 7 (PR #478 review): `entry.ts` imports `Container` from
// `@cloudflare/containers`, whose ESM build only resolves under workerd's
// module loader (see `containerEnv.ts`'s header comment) — so this cannot be a
// plain `import` + runtime-shape assertion under `node --test`. A source-text
// check is the closest thing to a regression guard we can run outside
// wrangler/workerd: `applyOutboundInterception` hard-throws at container start
// when `ctx.exports.ContainerProxy` is undefined, so losing this export line
// would silently make `deniedHosts` (and any outbound interception) inert.
void test("entry.ts re-exports ContainerProxy from @cloudflare/containers", () => {
  const entrySource = readFileSync(fileURLToPath(new URL("./entry.ts", import.meta.url)), "utf8");
  assert.match(entrySource, /export\s*\{\s*ContainerProxy\s*\}\s*from\s*["']@cloudflare\/containers["']/);
});
