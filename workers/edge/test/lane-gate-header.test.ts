/**
 * W2 (#1294): the staging gate header, as the door actually builds it.
 *
 * `web-search-lane.test.ts` reads the lanes verbatim — that is what catches a
 * NEW lane forgetting the door — but reading source can only ever prove the
 * code says the right thing. This one runs it: the module is imported with a
 * plainly-fake token in the environment, and the headers it hands back are
 * inspected. Nothing here reaches the network; `laneHeaders` is pure, and
 * `laneFetch` is deliberately not called.
 *
 * The token is read once at module load, so it is set before the dynamic
 * import and the whole file is one process's worth of that arrangement
 * (node:test gives each test FILE its own process, which is what makes this
 * safe to do at all). The value is a zero-entropy sentinel: the real one lives
 * in the operator's environment and belongs in no file in this repo.
 *
 * test-type: unit (no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";

const SENTINEL = "not-a-real-gate-token";
process.env.STAGING_GATE_TOKEN = SENTINEL;
process.env.CATALOG_API_ORIGIN = "https://staging.invalid";

const { laneHeaders } = await import("../api-test/lane-origin.ts");

void test("every request the door builds carries the gate header", () => {
  assert.equal(laneHeaders().get("x-staging-key"), SENTINEL);
});

void test("the gate rides alongside what the call itself needs, not instead of it", () => {
  const headers = laneHeaders({ "Content-Type": "application/json", "x-locale": "ja" });
  assert.deepEqual(
    ["content-type", "x-locale", "x-staging-key"].map((name) => headers.get(name)),
    ["application/json", "ja", SENTINEL],
  );
});

void test("a caller cannot substitute its own gate credential", () => {
  assert.equal(laneHeaders({ "x-staging-key": "something-else" }).get("x-staging-key"), SENTINEL);
});
