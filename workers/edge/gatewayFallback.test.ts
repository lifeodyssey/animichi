import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWorkerApp } from "./app.ts";

// Issue #537: the root Worker no longer bundles the legacy Next.js app, so
// there is no HTML renderer left to fall back to. An unmatched path is now a
// genuine 404 in the same JSON error envelope every other edge rejection uses
// (`unauthorized`, `rate_limited`) — a 200 "this is an API gateway" body would
// be a soft-404 that poisons crawlers and gives clients nothing to branch on.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function entrySource(): string {
  return readFileSync(fileURLToPath(new URL("./entry.ts", import.meta.url)), "utf8");
}

void test("an unmatched path is 404, not a rendered page", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/", {}, {}, stubCtx);
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
  let catalogHit = false;
  const env = { CATALOG: { fetch: () => { catalogHit = true; return Promise.resolve(new Response("cat")); } } } as never;
  const res = await app.request("/catalog/public/secret", {}, env, stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(catalogHit, false);
});

void test("entry.ts imports nothing from the retired OpenNext bundle", () => {
  assert.doesNotMatch(entrySource(), /\.open-next/);
});

void test("entry.ts no longer re-exports the OpenNext durable objects", () => {
  assert.doesNotMatch(entrySource(), /DOQueueHandler|DOShardedTagCache/);
});

void test("entry.ts still re-exports the container's own durable object", () => {
  assert.match(entrySource(), /export\s+class\s+RuntimeContainer/);
});
