import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Issue #1596 AC2: `GET /healthz` is the edge's own answer and `GET /` is
// retired, so neither landing surface may reach the container fetch seam. The
// spy sits on `fetchContainerResilient` itself — the seam the AC names — so the
// assertion is a runtime observation of the export every container-bound route
// rides, not a source grep. The CONTAINER binding's fetch is counted too,
// because a route that reached the container without the resilient wrapper
// would still be a container call. `mock.module` has to be registered before
// the mocked module is loaded, so the app is imported dynamically below; the
// `/v1` case proves the spy is live and that the forward is still the seam's
// one caller. #1599 moved that proof onto `PATCH
// /v1/conversations/{session_id}`: `GET /v1/conversations` is the edge's own
// conversation index now, so it never reaches the seam.

const seam = { calls: 0 };
const container = { fetches: 0 };

const realContainerFetch = await import("../src/gateway/container-fetch.ts");
mock.module("../src/gateway/container-fetch.ts", {
  exports: {
    ...realContainerFetch,
    fetchContainerResilient: (...args: Parameters<typeof realContainerFetch.fetchContainerResilient>) => {
      seam.calls += 1;
      return realContainerFetch.fetchContainerResilient(...args);
    },
  },
});

const { createWorkerApp } = await import("../src/app.ts");
const { alwaysAllowGuard, stubCtx } = await import("../src/container/entry-env.ts");

/** A CONTAINER binding whose every fetch counts itself. `EDGE_GUARD` is the
 * always-allow double because the `/v1` case probes the durable-guarded rename
 * route below: without it the limiter fails closed before the seam and the spy
 * would measure nothing. */
function countingEnv() {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => countedFetch(container) }),
    },
  } as never;
}

/** The binding's fetch: it counts itself and answers like the container. */
function countedFetch(counted: { fetches: number }): Promise<Response> {
  counted.fetches += 1;
  return Promise.resolve(new Response("container"));
}

test.beforeEach(() => {
  seam.calls = 0;
  container.fetches = 0;
});

void test("the readiness probe never reaches the container fetch seam", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/healthz", {}, countingEnv(), stubCtx);
  assert.deepEqual(await res.json(), { status: "ok" });
  assert.equal(seam.calls, 0, "/healthz must not ride fetchContainerResilient");
  assert.equal(container.fetches, 0, "/healthz must not touch the CONTAINER binding");
});

void test("the retired root never reaches the container fetch seam", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/", {}, countingEnv(), stubCtx);
  assert.equal(res.status, 404, "/ is an unmatched path, never a container banner");
  assert.equal(seam.calls, 0, "/ must not ride fetchContainerResilient");
  assert.equal(container.fetches, 0, "/ must not touch the CONTAINER binding");
});

void test("the /v1 forward still rides the seam, so the spy is live", async () => {
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
  });
  const res = await app.request("/v1/conversations/s-1", { method: "PATCH" }, countingEnv(), stubCtx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "container");
  assert.equal(seam.calls, 1, "/v1 must ride fetchContainerResilient");
  assert.equal(container.fetches, 1);
});
