/**
 * W1-7 (#1256): the fallback flag that decides WHERE a `/v1` turn is served —
 * the Python container that serves it today, or the TS agent tier in this
 * Worker. `container` is the default in every environment, so an environment
 * that never heard of the flag keeps today's behaviour.
 *
 * test-type: unit (pure policy, no bindings, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { turnRoutePolicy } from "../src/gateway/routing-policy.ts";

const CHAT = "/v1/chat";
const PROBE = "/v1/byok/probe";
const TRANSCRIPT = "/v1/conversations/s-42/messages";

void test("an unset flag selects nothing — every /v1 request keeps forwarding", () => {
  const policy = turnRoutePolicy(undefined);
  assert.equal(policy.select("POST", CHAT), null);
  assert.equal(policy.select("GET", TRANSCRIPT), null);
});

void test('the literal "container" selects nothing either — it names today\'s forward', () => {
  const policy = turnRoutePolicy("container");
  assert.equal(policy.select("POST", CHAT), null);
  assert.equal(policy.select("GET", TRANSCRIPT), null);
});

void test('"edge" routes POST /v1/chat to the turn handoff', () => {
  assert.deepEqual(turnRoutePolicy("edge").select("POST", CHAT), { kind: "turn" });
});

void test('"edge" routes the transcript GET to retrieval, carrying the session id', () => {
  assert.deepEqual(turnRoutePolicy("edge").select("GET", TRANSCRIPT), {
    kind: "transcript",
    sessionId: "s-42",
  });
});

void test("a percent-encoded session id reaches retrieval decoded", () => {
  assert.deepEqual(turnRoutePolicy("edge").select("GET", "/v1/conversations/a%2Fb/messages"), {
    kind: "transcript",
    sessionId: "a/b",
  });
});

// W2-3 (#1289): the BYOK probe joined the flag's set. It has to move with the
// turn — a credential the edge validated for `/v1/chat` and the same credential
// validated by the container for the probe would be two verdicts on one key.
void test('"edge" routes POST /v1/byok/probe to the tier as well', () => {
  assert.deepEqual(turnRoutePolicy("edge").select("POST", PROBE), { kind: "probe" });
});

void test("the probe keeps forwarding to the container while the flag says so", () => {
  assert.equal(turnRoutePolicy("container").select("POST", PROBE), null);
  assert.equal(turnRoutePolicy(undefined).select("POST", PROBE), null);
});

void test("the three routes are matched on method as well as path", () => {
  const policy = turnRoutePolicy("edge");
  assert.equal(policy.select("GET", CHAT), null);
  assert.equal(policy.select("GET", PROBE), null);
  assert.equal(policy.select("DELETE", TRANSCRIPT), null);
});

void test("every other /v1 path is left to the container under both flag values", () => {
  const others = ["/v1/photo-search", "/v1/conversations", "/v1/search/preview"];
  const container = others.map((path) => turnRoutePolicy("container").select("POST", path));
  const edge = others.map((path) => turnRoutePolicy("edge").select("POST", path));
  assert.deepEqual(container, others.map(() => null));
  assert.deepEqual(edge, others.map(() => null));
});

void test("a malformed value falls back to the container, not to the new tier", () => {
  const policy = turnRoutePolicy("EDGE ");
  assert.equal(policy.select("POST", CHAT), null);
});
