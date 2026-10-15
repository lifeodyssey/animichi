import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/gateway/request-class.ts";

// One classification per request, and the class decides everything downstream
// (dispatch, the request record). #1596 retired the container's
// JSON banner at `/`, so `/` is now the not-found class like any other
// unmatched path; `/healthz` stays the landing asset the edge answers itself.

void test("the retired root classifies as not-found", () => {
  assert.deepEqual(classify(new Request("https://edge.test/", { method: "GET" })), { kind: "not-found" });
});

void test("the readiness probe keeps its own landing class", () => {
  assert.deepEqual(classify(new Request("https://edge.test/healthz", { method: "GET" })), {
    kind: "landing",
    asset: "healthz",
  });
});
