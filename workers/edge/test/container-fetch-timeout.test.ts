import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  CONTAINER_FETCH_HEAD_TIMEOUT_MS,
  fetchContainerResilient,
  fetchContainerWithHeadTimeout,
} from "../src/gateway/container-fetch.ts";

const noopSleep = (): Promise<void> => Promise.resolve();

/** A container fetch that hangs forever — the shape a stalled cold start or a
 * wedged container takes: no response, no error, just silence. */
function neverResolvingFetch(captured: { request?: Request }): (request: Request) => Promise<Response> {
  return (request) => {
    captured.request = request;
    return new Promise<Response>(() => { /* intentionally never settles */ });
  };
}

// Issue #1220: env.CONTAINER.get(...).fetch(...) previously had no bound at
// all — a wedged container hung the caller forever. Mutation guard: removing
// the `Promise.race` in `fetchContainerWithHeadTimeout` (reverting to a bare
// `fetchFn(request)`) makes this test hang past the timeout instead of
// resolving 504, which node:test reports red.

void test("a container fetch that never settles resolves 504 once the 60s head timeout elapses", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const captured: { request?: Request } = {};
    const resultPromise = fetchContainerResilient(
      neverResolvingFetch(captured), new Request("https://edge.test/v1/chat"), noopSleep,
    );
    mock.timers.tick(CONTAINER_FETCH_HEAD_TIMEOUT_MS);
    const res = await resultPromise;
    assert.equal(res.status, 504);
    assert.equal(captured.request?.signal.aborted, true);
  } finally {
    mock.timers.reset();
  }
});

void test("the head timeout does not fire one tick before its deadline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const captured: { request?: Request } = {};
    const resultPromise = fetchContainerResilient(
      neverResolvingFetch(captured), new Request("https://edge.test/v1/chat"), noopSleep,
    );
    mock.timers.tick(CONTAINER_FETCH_HEAD_TIMEOUT_MS - 1);
    assert.equal(captured.request?.signal.aborted, false);
    mock.timers.tick(1);
    assert.equal((await resultPromise).status, 504);
  } finally {
    mock.timers.reset();
  }
});

/** A container fetch whose implementation reacts to `AbortSignal` the way a
 * real `fetch` does: the abort listener rejects the pending promise
 * synchronously, from inside the same call stack as `controller.abort()`. */
function fetchRejectingOnAbort(request: Request): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    request.signal.addEventListener("abort", () => { reject(new Error("The operation was aborted.")); });
  });
}

// Mutation guard: swapping `armHeadTimeout`'s `resolve(...)` / `controller.abort()`
// order back to abort-then-resolve makes `controller.abort()`'s synchronous abort
// event reject `fetchPromise` before `timedOut` resolves, so `Promise.race` rejects
// instead of returning 504 — this test goes red on that reorder. Exercised against
// `fetchContainerWithHeadTimeout` directly, not `fetchContainerResilient`: the
// latter wraps `fetchFn` through `fetchContainerWithStartupRetry`'s own async
// layers, whose extra microtask ticks on the rejection path make the reorder
// unobservable there (confirmed by hand: the same mutation left that path green).

void test("a fetch whose abort listener rejects synchronously still resolves 504, not reject", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const resultPromise = fetchContainerWithHeadTimeout(
      fetchRejectingOnAbort, new Request("https://edge.test/v1/chat"), CONTAINER_FETCH_HEAD_TIMEOUT_MS,
    );
    mock.timers.tick(CONTAINER_FETCH_HEAD_TIMEOUT_MS);
    const res = await resultPromise;
    assert.equal(res.status, 504);
  } finally {
    mock.timers.reset();
  }
});

// A normal (non-hanging) response — including one whose body is a live SSE
// stream — must pass through untouched: the head timeout only bounds the
// wait for the response object itself, never the body that follows.

void test("a container fetch that settles well before the head timeout is returned unchanged, never aborted", async () => {
  const captured: { request?: Request } = {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: ping\n\n"));
      controller.close();
    },
  });
  const fetchFn = (request: Request): Promise<Response> => {
    captured.request = request;
    return Promise.resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
  };

  const res = await fetchContainerResilient(fetchFn, new Request("https://edge.test/v1/chat"), noopSleep);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  assert.equal(await res.text(), "data: ping\n\n");
  assert.equal(captured.request?.signal.aborted, false);
});
