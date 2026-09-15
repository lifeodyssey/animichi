import test from "node:test";
import assert from "node:assert/strict";
import { turnRoutePolicy } from "../src/gateway/routing-policy.ts";

void test("chat, credential probe, conversation list and transcript always select the native tier", () => {
  const policy = turnRoutePolicy();
  assert.deepEqual(policy.select("POST", "/v1/chat"), { kind: "turn" });
  assert.deepEqual(policy.select("POST", "/v1/byok/probe"), { kind: "probe" });
  assert.deepEqual(policy.select("GET", "/v1/conversations"), { kind: "list" });
  assert.deepEqual(policy.select("GET", "/v1/conversations/s-42/messages"), { kind: "transcript", sessionId: "s-42" });
  assert.deepEqual(policy.select("GET", "/v1/conversations/s-42/stream"), { kind: "stream", sessionId: "s-42" });
});

void test("a percent-encoded session id reaches native retrieval decoded", () => {
  assert.deepEqual(turnRoutePolicy().select("GET", "/v1/conversations/a%2Fb/messages"), { kind: "transcript", sessionId: "a/b" });
});

void test("native routes remain exact about HTTP methods", () => {
  const policy = turnRoutePolicy();
  assert.equal(policy.select("GET", "/v1/chat"), null);
  assert.equal(policy.select("GET", "/v1/byok/probe"), null);
  assert.equal(policy.select("DELETE", "/v1/conversations/s-42/messages"), null);
});

void test("the conversation index is a GET list and nothing else on that path is native", () => {
  const policy = turnRoutePolicy();
  assert.equal(policy.select("GET", "/v1/conversations/"), null, "the list path is exact, like every other tier path");
  assert.equal(policy.select("PATCH", "/v1/conversations"), null, "the rename route is still the container's");
  assert.equal(policy.select("GET", "/v1/conversations/s-42"), null);
});

void test("other gateway surfaces are not mistaken for native turns", () => {
  const others = ["/v1/photo-search", "/v1/conversations", "/v1/search/preview"];
  assert.deepEqual(others.map((path) => turnRoutePolicy().select("POST", path)), [null, null, null]);
});
