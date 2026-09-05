import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";

const NOT_RUNNING_BODY = "The container is not running, consider calling start()";

/** A CONTAINER binding stub whose fetch serves the given attempts in order.
 * EDGE_SHOWCASE_MODE is "false" for the /v1 tests below (functional routes,
 * unlike /healthz, are denied in showcase mode) — an inert field for the
 * /healthz cases, which bypass the showcase gate entirely. */
function notRunningEnv(attempts: (() => Promise<Response>)[]) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => containerFetch(attempts) }),
    },
  } as never;
}

function containerFetch(attempts: (() => Promise<Response>)[]): Promise<Response> {
  const next = attempts.shift();
  if (next === undefined) throw new Error("container fetch called more times than stubbed");
  return next();
}

/** Resolves instantly, recording the backoff durations it was asked to wait. */
function instantSleep(called: number[]): (ms: number) => Promise<void> {
  return (ms) => {
    called.push(ms);
    return Promise.resolve();
  };
}

// Issue #694: while a container is still starting, /healthz fetches can 500
// with a "not running" body. The edge retries briefly instead of failing the
// readiness probe, then passes the final failure through unchanged.

void test("a not-running 500 is retried with 400/800ms backoff and the eventual success is returned", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response("ok")),
  ]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.deepEqual(sleeps, [400, 800]);
});

void test("a persistently not-running container returns the final 500 unchanged after 3 attempts", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
  ]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), NOT_RUNNING_BODY);
  assert.deepEqual(sleeps, [400, 800]);
});

void test("a thrown not-running fetch error is retried like the 500 body", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([
    () => Promise.reject(new Error(NOT_RUNNING_BODY)),
    () => Promise.reject(new Error(NOT_RUNNING_BODY)),
    () => Promise.resolve(new Response("ok")),
  ]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.deepEqual(sleeps, [400, 800]);
});

void test("a plain 500 is returned immediately without retrying", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([() => Promise.resolve(new Response("boom", { status: 500 }))]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "boom");
  assert.deepEqual(sleeps, []);
});

// EG-06 (#1343): this case used to pin Hono's plain-text "Internal Server
// Error" — the gap turned into a contract. A container error that is not a
// cold start is still not retried, and now answers the shared edge envelope.
void test("a non-not-running fetch error passes through without retry", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([() => Promise.reject(new Error("disk full"))]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), {
    error: { code: "internal_error", message: "The gateway could not complete this request." },
  });
  assert.deepEqual(sleeps, []);
});

// Issue #1220: the /healthz-only startup retry above left every /v1 forward
// (search, chat, guide — anything routed through gateway/forward.ts's
// forwardV1) to fail bare on a cold-start "not running" 500. These tests
// pin the same fetchContainerWithStartupRetry now wired into forwardV1
// (via fetchContainerResilient, gateway/container-fetch.ts) for the public
// /v1 surface — mutation guard: reverting forwardV1 to call
// `container.fetch` directly turns the first test red.

void test("/v1 retries a not-running 500 with 400/800ms backoff, then forwards the eventual success", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response("preview results")),
  ]);

  const res = await app.request("/v1/search/preview?q=test", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "preview results");
  assert.deepEqual(sleeps, [400]);
});

// EG-21 (#1343): the landing forwards (`GET /` and `GET /healthz`) reached the
// container without the bound `/v1` had. Both ride `fetchContainerResilient`
// now — mutation guard: reverting the banner to a bare `container.fetch` turns
// this red, because the cold-start retry and the head timeout are one call.
void test("the root banner rides the same cold-start retry as /v1", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response("banner")),
  ]);

  const res = await app.request("/", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "banner");
  assert.deepEqual(sleeps, [400]);
});

void test("/healthz still answers the smoke's own contract through the bounded fetch", async () => {
  const app = createWorkerApp({ sleep: instantSleep([]) });
  const env = notRunningEnv([() => Promise.resolve(Response.json({ status: "ok" }))]);

  const res = await app.request("/healthz", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

void test("/v1 does not retry a genuine (non-not-running) container error", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([() => Promise.resolve(new Response("boom", { status: 500 }))]);

  const res = await app.request("/v1/search/preview?q=test", {}, env, stubCtx);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "boom");
  assert.deepEqual(sleeps, []);
});
