import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-paths";

// SUT: the Agent path inventory (`AGENT_PATHS`, CONTRACT-1 #938) as this
// Worker's routing reads it. EDGE-1 #963: the gateway's route table references
// the inventory instead of floating hand-maintained magic strings — an agent
// tier entry the inventory does not carry fails module load
// (`src/gateway/route-table.ts`), so a retired path can never silently stay
// served. What a retirement promises here is inventory absence; that the
// retired path is now the shared 404, with no limiter asked, is pinned end to
// end through the app in `gateway-entry-rate-class.test.ts`.
//
// The identity-class table this file used to pin alongside it
// (`ANON_V1_PATHS`) was deleted with the container forward it gated in #1605:
// an uncredentialed caller is admitted by the native tier's by-kind list,
// which `agent-turn-routing.test.ts` pins behaviourally.

const inventoryPaths = new Set(AGENT_PATHS.map((entry) => entry.path));

void test("retired /v1/runtime paths are out of the inventory", () => {
  assert.equal(inventoryPaths.has("/v1/runtime"), false);
  assert.equal(inventoryPaths.has("/v1/runtime/stream"), false);
});

// #1596: the container's JSON banner at `/` was retired with its landing
// forward, so the root is out of the inventory the same way `/v1/runtime` is.
// `/v1/runtime` also has its `/v1/runtime/stream` sibling retired beside it, so
// that case pins both paths; the root has no sibling surface, so one pin is the
// whole set.
void test("the retired root is out of the inventory", () => {
  assert.equal(inventoryPaths.has("/"), false);
});

void test("the conversation index is a gateway-owned inventory entry, not a Python route", () => {
  const index = AGENT_PATHS.find((entry) => entry.method === "GET" && entry.path === "/v1/conversations");
  assert.equal(index?.runtime, "edge", "no agent runtime mounts the list; this Worker serves it");
});

// #1595: `/v1/feedback` was retired with the feature behind it — the shape
// every retirement is pinned to.
void test("retired /v1/feedback is out of the inventory", () => {
  assert.equal(inventoryPaths.has("/v1/feedback"), false);
});

// #1597: the three uncalled catalog reads left the inventory together. The
// inventory is keyed by the template each was advertised as; with the last
// three gone, no `/v1` read is served without a credential.
void test("the three retired catalog reads are out of the inventory", () => {
  assert.equal(inventoryPaths.has("/v1/search/preview"), false);
  assert.equal(inventoryPaths.has("/v1/bangumi/{bangumi_id}/guide"), false);
  assert.equal(inventoryPaths.has("/v1/bangumi/nearby"), false);
});

void test("retired conversation rename is out of the inventory", () => {
  assert.equal(inventoryPaths.has("/v1/conversations/{session_id}"), false);
});

// #1604 deleted the photo search surface rather than rebuilding it, so both
// routes left the inventory — the same retirement shape #1595 pinned for
// `/v1/feedback` and #1597 for the catalog reads.
void test("the deleted photo-search routes are out of the inventory", () => {
  for (const path of ["/v1/photo-search", "/v1/photo-search/confirm"]) {
    assert.equal(inventoryPaths.has(path), false, `${path} must not be advertised`);
  }
});

void test("the retired staging prefix route is out of the inventory", () => {
  assert.equal(inventoryPaths.has("/v1/staging/sessions/{session_id}/prefix"), false);
});
