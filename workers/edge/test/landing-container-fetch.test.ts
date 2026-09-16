import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Issue #1596 AC2: `GET /healthz` is the edge's own answer and `GET /` is
// retired, so neither landing surface may reach the container fetch seam. The
// spy sits on `fetchContainerResilient` itself — the seam the AC names — so the
// assertion is a runtime observation of the export every container-bound route
// rides, not a source grep. The CONTAINER binding's fetch is counted too,
// because a route that reached the container without the resilient wrapper
// would still be a container call. `mock.module` has to be registered before
// the mocked module is loaded, so the app is imported dynamically below.
// #1604 deleted `POST /v1/photo-search`, which was the last container-forwarded
// `/v1` route and the case that used to prove this spy live by riding it; the
// liveness proof below calls the mocked seam directly instead, so no product
// route has to exist for the two landing assertions to keep their teeth.

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
const { stubCtx } = await import("../src/container/entry-env.ts");

/** A CONTAINER binding whose every fetch counts itself. */
function countingEnv() {
  return {
    EDGE_SHOWCASE_MODE: "false",
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

void test("the spy on `fetchContainerResilient` is live", async () => {
  // #1604: with no container-forwarded route left, the liveness proof calls the
  // mocked export itself. Nothing below rides a product route — this case exists so
  // the two landing assertions above cannot pass through a mock that never
  // registered.
  const { fetchContainerResilient } = await import("../src/gateway/container-fetch.ts");
  const res = await fetchContainerResilient(
    () => countedFetch(container), new Request("https://edge.test/healthz"), () => Promise.resolve(),
  );
  assert.equal(await res.text(), "container");
  assert.equal(seam.calls, 1, "the mocked seam must be the one this import resolves to");
  assert.equal(container.fetches, 1);
});
