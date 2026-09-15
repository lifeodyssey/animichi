import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-paths";
import { ANON_V1_PATHS, isAnonymousV1 } from "../src/gateway/routing-policy.ts";
import { classifyRatePolicy } from "../src/gateway/rate-policy.ts";

// EDGE-1 #963: the edge's route tables derive from the AGENT_PATHS inventory
// (CONTRACT-1 #938) instead of floating as hand-maintained magic strings. A
// table entry that is not in the inventory fails module load (fail closed),
// so a retired path can never silently re-enter an allowlist.
//
// Rate-limit classification itself is one decision table in
// `rate-policy.ts`; this file only pins the identity-class table in the
// routing policy.

const inventoryPaths = new Set(AGENT_PATHS.map((entry) => entry.path));

function assertEveryEntryInInventory(paths: readonly string[], table: string): void {
  for (const path of paths) {
    assert.equal(
      inventoryPaths.has(path),
      true,
      `${table} entry "${path}" is not in the AGENT_PATHS inventory — delete the route or update the table`,
    );
  }
}

void test("every ANON_V1 table entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(ANON_V1_PATHS, "ANON_V1");
});

void test("retired /v1/runtime paths match no inventory and classify as unmanaged", () => {
  assert.equal(inventoryPaths.has("/v1/runtime"), false);
  assert.equal(inventoryPaths.has("/v1/runtime/stream"), false);
  assert.equal(classifyRatePolicy("POST", "/v1/runtime").limiter, "none", "a retired path must not be classified into a guarded cell");
  assert.equal(classifyRatePolicy("POST", "/v1/runtime/stream").limiter, "none");
});

// #1596: the container's JSON banner at `/` was retired with its landing
// forward, so the root is out of the inventory the same way `/v1/runtime` is —
// and with it out of every derived table, at no rate-limit cell. `/v1/runtime`
// also has its `/v1/runtime/stream` sibling retired beside it, so that case pins
// both paths; the root has no sibling surface, so one pin is the whole set.
void test("the retired root matches no inventory and classifies as unmanaged", () => {
  assert.equal(inventoryPaths.has("/"), false);
  assert.equal(classifyRatePolicy("GET", "/").limiter, "none", "a retired path must not be classified into a guarded cell");
});

void test("the conversation index is a gateway-owned inventory entry, not a Python route", () => {
  const index = AGENT_PATHS.find((entry) => entry.method === "GET" && entry.path === "/v1/conversations");
  assert.equal(index?.runtime, "edge", "the container does not mount the list; this Worker serves it");
});

// #1597: the three uncalled catalog reads leave the inventory, the tables
// derived from it and the rate policy together, so each is pinned at the same
// shape as the retired `/v1/runtime` paths above: nothing advertises it and no
// limiter cell classifies it. The inventory is keyed by the template each was
// advertised as, the classifier's matcher by a concrete path; with the last
// three gone, no `/v1` read is served without a credential.
void test("the three retired catalog reads match no inventory and no limiter cell", () => {
  assert.equal(inventoryPaths.has("/v1/search/preview"), false);
  assert.equal(
    classifyRatePolicy("GET", "/v1/search/preview").limiter,
    "none",
    "a retired path must not be classified into a guarded cell",
  );
  assert.equal(inventoryPaths.has("/v1/bangumi/{bangumi_id}/guide"), false);
  assert.equal(classifyRatePolicy("GET", "/v1/bangumi/485/guide").limiter, "none");
  assert.equal(inventoryPaths.has("/v1/bangumi/nearby"), false);
  assert.equal(classifyRatePolicy("GET", "/v1/bangumi/nearby").limiter, "none");
});

void test("anonymous allowlist membership matches the inventory's paths", () => {
  assert.equal(isAnonymousV1("/v1/chat"), true);
  assert.equal(isAnonymousV1("/v1/photo-search"), true);
  assert.equal(isAnonymousV1("/v1/photo-search/confirm"), true);
  assert.equal(isAnonymousV1("/v1/feedback"), false);
});

void test("the retired staging prefix route remains outside every allowlist", () => {
  assert.equal(inventoryPaths.has("/v1/staging/sessions/{session_id}/prefix"), false);
  assert.equal(isAnonymousV1("/v1/staging/sessions/s-1/prefix"), false);
  assert.equal(classifyRatePolicy("POST", "/v1/staging/sessions/s-1/prefix").limiter, "none");
});
