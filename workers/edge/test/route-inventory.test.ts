import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-contract";
import {
  ANON_V1_PATHS,
  AUTH_RATE_LIMITED_PATHS,
  AUTH_RATE_LIMITED_PREFIX,
  PUBLIC_V1_PATHS,
  isAnonymousV1,
  isAuthRateLimited,
  isPublicV1,
} from "../src/gateway/routing-policy.ts";

// EDGE-1 #963: the edge's route tables derive from the AGENT_PATHS inventory
// (CONTRACT-1 #938) instead of floating as hand-maintained magic strings. A
// table entry that is not in the inventory fails module load (fail closed),
// so a retired path can never silently re-enter an allowlist.

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

void test("every PUBLIC_V1 table entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(PUBLIC_V1_PATHS, "PUBLIC_V1");
});

void test("every ANON_V1 table entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(ANON_V1_PATHS, "ANON_V1");
});

void test("every AUTH_RATE_LIMITED entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(AUTH_RATE_LIMITED_PATHS, "AUTH_RATE_LIMITED");
});

void test("the BYOK rate-limit prefix derives from the inventory's byok route", () => {
  assert.equal(AUTH_RATE_LIMITED_PREFIX, "/v1/byok/");
  assert.equal(
    AGENT_PATHS.some((entry) => entry.path.startsWith(AUTH_RATE_LIMITED_PREFIX)),
    true,
    "the prefix must point at a route the inventory actually carries",
  );
});

void test("retired /v1/runtime paths match no route table (TURN-4 #955)", () => {
  assert.equal(inventoryPaths.has("/v1/runtime"), false);
  assert.equal(inventoryPaths.has("/v1/runtime/stream"), false);
  assert.equal(isAuthRateLimited("/v1/runtime"), false);
  assert.equal(isAuthRateLimited("/v1/runtime/stream"), false);
});

void test("the guide route pattern derives from the inventory's parameter template", () => {
  assert.equal(isPublicV1("/v1/bangumi/485/guide"), true);
  assert.equal(isPublicV1("/v1/bangumi/guide"), false, "the parameter segment is required");
  assert.equal(isPublicV1("/v1/bangumi/485/guide/"), false, "trailing slash must not extend the template");
  assert.equal(isPublicV1("/v1/bangumi/485/guide/extra"), false, "an anchored template must not prefix-match");
});

void test("anonymous allowlist membership matches the inventory's paths", () => {
  assert.equal(isAnonymousV1("/v1/chat"), true);
  assert.equal(isAnonymousV1("/v1/photo-search"), true);
  assert.equal(isAnonymousV1("/v1/photo-search/confirm"), true);
  assert.equal(isAnonymousV1("/v1/feedback"), false);
});
