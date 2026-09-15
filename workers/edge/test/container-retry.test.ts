import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { alwaysAllowGuard, stubCtx } from "../src/container/entry-env.ts";

const NOT_RUNNING_BODY = "The container is not running, consider calling start()";

/** A CONTAINER binding stub whose fetch serves the given attempts in order.
 * `EDGE_GUARD` is the always-allow double because the probed route is
 * durable-guarded (`classifyRatePolicy` -> `DURABLE_HIGH_COST`): without it the
 * limiter fails closed on the unbound namespace and the forward never runs. */
function notRunningEnv(attempts: (() => Promise<Response>)[]) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: alwaysAllowGuard,
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

/** The edge's own verdict for a caller it verified: the container-served `POST
 * /v1/photo-search` reaches `forwardV1` only after this. */
const verified = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);

function retryingApp(sleeps: number[]) {
  return createWorkerApp({ sleep: instantSleep(sleeps), authenticate: verified });
}

// Issue #1220: a container that is still starting answers a 500 whose body
// carries the "not running" marker (or throws an error that does), so every
// `/v1` forward — photo-search and its confirm sibling, anything through
// gateway/forward.ts's `forwardV1` — rides `fetchContainerResilient` instead of
// failing the caller on a cold start. Issue #694 first added that retry for the
// container-served `/healthz`; #1596 moved the readiness probe into the edge
// and retired `GET /`, and #1597 retired the three credential-free reads, so
// the `/v1` forwards are the retry's only remaining callers (their reach of the
// seam itself is pinned in `landing-container-fetch.test.ts`). The synthetic
// forward here is `POST /v1/photo-search`: #1599 turned `GET /v1/conversations`
// into the edge's own conversation index, #1598 retired the container's rename,
// and photo-search is the surviving container-forwarded route. Its durable
// limiter is stubbed open, leaving the retry as the thing under test.

void test("/v1 retries a not-running 500 with 400/800ms backoff, then forwards the eventual success", async () => {
  const sleeps: number[] = [];
  const app = retryingApp(sleeps);
  const env = notRunningEnv([
    () => Promise.resolve(new Response(NOT_RUNNING_BODY, { status: 500 })),
    () => Promise.resolve(new Response("container results")),
  ]);

  const res = await app.request("/v1/photo-search", { method: "POST" }, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "container results");
  assert.deepEqual(sleeps, [400]);
});

void test("/v1 returns the final not-running 500 unchanged after 3 attempts", async () => {
  const sleeps: number[] = [];
  const app = retryingApp(sleeps);
  const env = notRunningEnv(notRunningAttempts(3));

  const res = await app.request("/v1/photo-search", { method: "POST" }, env, stubCtx);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), NOT_RUNNING_BODY);
  assert.deepEqual(sleeps, [400, 800]);
});

void test("a thrown not-running fetch error is retried like the 500 body", async () => {
  const sleeps: number[] = [];
  const app = retryingApp(sleeps);
  const env = notRunningEnv([
    () => Promise.reject(new Error(NOT_RUNNING_BODY)),
    () => Promise.reject(new Error(NOT_RUNNING_BODY)),
    () => Promise.resolve(new Response("container results")),
  ]);

  const res = await app.request("/v1/photo-search", { method: "POST" }, env, stubCtx);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "container results");
  assert.deepEqual(sleeps, [400, 800]);
});

void test("/v1 does not retry a genuine (non-not-running) container error", async () => {
  const sleeps: number[] = [];
  const app = retryingApp(sleeps);
  const env = notRunningEnv([() => Promise.resolve(new Response("boom", { status: 500 }))]);

  const res = await app.request("/v1/photo-search", { method: "POST" }, env, stubCtx);

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "boom");
  assert.deepEqual(sleeps, []);
});
