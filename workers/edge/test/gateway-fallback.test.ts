import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { gatewayEnv } from "./doubles/entry-env.ts";

// Issue #537: the edge Worker no longer bundles the legacy Next.js app, so
// there is no HTML renderer left to fall back to. An unmatched path is now a
// genuine 404 in the same JSON error envelope every other edge rejection uses
// (`unauthorized`, `rate_limited`) — a 200 "this is an API gateway" body would
// be a soft-404 that poisons crawlers and gives clients nothing to branch on.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function entrySource(): string {
  return readFileSync(fileURLToPath(new URL("../src/entry.ts", import.meta.url)), "utf8");
}

void test("an unmatched path is 404, not a rendered page", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/unmatched/path", {}, {}, stubCtx);
  assert.equal(res.status, 404);
});

void test("the unmatched-path body is the shared JSON error envelope", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/some/legacy/page", {}, {}, stubCtx);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
});

void test("a non-allowlisted /catalog/public path answers the same 404 envelope", async () => {
  const app = createWorkerApp({});
  let wasCatalogHit = false;
  const env = { CATALOG: { fetch: () => { wasCatalogHit = true; return Promise.resolve(new Response("cat")); } } } as never;
  const res = await app.request("/catalog/public/secret", {}, env, stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(wasCatalogHit, false);
});

// #1596: the container's JSON service banner at `/` was retired with its
// container landing forward, so the root is an unmatched path like any other —
// 404 in the shared envelope. #1605 then deleted the container itself, which is
// what makes "never a banner" structural rather than a branch.
void test("the retired root is a hard 404 in the shared envelope", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/", {}, gatewayEnv(), stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
});

void test("the deleted /v1/session/migrate path is a hard 404 (SESSION-2 #960)", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/v1/session/migrate", { method: "POST" }, gatewayEnv(), stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
});

void test("entry.ts imports nothing from the retired OpenNext bundle", () => {
  assert.doesNotMatch(entrySource(), /\.open-next/);
});

void test("entry.ts no longer re-exports the OpenNext durable objects", () => {
  assert.doesNotMatch(entrySource(), /DOQueueHandler|DOShardedTagCache/);
});

// #1605 replaced the old "still re-exports the container's own durable object"
// case with its inverse: the class, the `ContainerProxy` re-export and the
// `@cloudflare/containers` import left `entry.ts` with the container. This is
// the cheap source-level companion to the AC's real proof — the built entry's
// module graph and exports, asserted in `bundle-smoke/entry-bundle.test.ts` —
// so it matches import/export SYNTAX only: the file's own comments name the
// deleted symbols on purpose, and a bare word match would forbid that history.
void test("entry.ts no longer imports or re-exports the retired container surface", () => {
  assert.doesNotMatch(entrySource(), /from\s+"@cloudflare\/containers"/);
  assert.doesNotMatch(entrySource(), /export\s+\{[^}]*ContainerProxy[^}]*\}|export\s+class\s+RuntimeContainer/);
});
