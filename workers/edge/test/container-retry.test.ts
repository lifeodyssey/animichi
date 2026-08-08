import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";

const NOT_RUNNING_BODY = "The container is not running, consider calling start()";

/** A CONTAINER binding stub whose fetch serves the given attempts in order. */
function notRunningEnv(attempts: (() => Promise<Response>)[]) {
  return {
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

  const res = await app.request("/healthz", {}, env);

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

  const res = await app.request("/healthz", {}, env);

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

  const res = await app.request("/healthz", {}, env);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.deepEqual(sleeps, [400, 800]);
});

void test("a plain 500 is returned immediately without retrying", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([() => Promise.resolve(new Response("boom", { status: 500 }))]);

  const res = await app.request("/healthz", {}, env);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "boom");
  assert.deepEqual(sleeps, []);
});

void test("a non-not-running fetch error passes through without retry", async () => {
  const sleeps: number[] = [];
  const app = createWorkerApp({ sleep: instantSleep(sleeps) });
  const env = notRunningEnv([() => Promise.reject(new Error("disk full"))]);

  const res = await app.request("/healthz", {}, env);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "Internal Server Error");
  assert.deepEqual(sleeps, []);
});
