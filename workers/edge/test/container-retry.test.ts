import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";

const NOT_RUNNING_BODY = "The container is not running, consider calling start()";

/** A CONTAINER binding stub whose fetch serves the given attempts in order. */
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

/** The whole retry budget spent: `count` consecutive not-running 500 attempts. */
function notRunningAttempts(count: number): (() => Promise<Response>)[] {
  return Array.from({ length: count }, () => () =>
    Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
  );
}

/** Resolves instantly, recording the backoff durations it was asked to wait. */
function instantSleep(called: number[]): (ms: number) => Promise<void> {
  return (ms) => {
    called.push(ms);
    return Promise.resolve();
  };
}

// Issue #1220: a container that is still starting answers a 500 whose body
// carries the "not running" marker (or throws an error that does), so every
// `/v1` forward — search, chat, guide, anything through gateway/forward.ts's
// `forwardV1` — rides `fetchContainerResilient` instead of failing the caller
// on a cold start. Issue #694 first added that retry for the container-served
// `/healthz`; #1596 moved the readiness probe into the edge and retired
// `GET /`, so the `/v1` forwards are the retry's only remaining callers (their
// reach of the seam itself is pinned in `landing-container-fetch.test.ts`).

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

void test("/v1 returns the final not-running 500 unchanged after 3 attempts", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv(notRunningAttempts(3));

  const res = await app.request("/v1/search/preview?q=test", {}, env, stubCtx);

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
    () => Promise.resolve(new Response("preview results")),
  ]);

  const res = await app.request("/v1/search/preview?q=test", {}, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "preview results");
  assert.deepEqual(sleeps, [400, 800]);
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
