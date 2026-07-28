import test from "node:test";
import assert from "node:assert/strict";
import { isAuthRateLimited } from "./app.ts";

// P2-5 (issue #284 / Task 9, round 3): the authenticated cost-path allowlist
// was an exact-match `Array.includes`, so a trailing slash on the path
// bypassed the limiter outright — "/v1/byok/probe/" counted for nothing.
// Fable's follow-up finding: /v1/runtime + /v1/runtime/stream run a full
// agent turn on the house model key (same cost shape as /v1/chat) and reach
// this same authenticated branch, but were never on the allowlist at all.

void test("the exact cost-bearing routes are limited", () => {
  assert.equal(isAuthRateLimited("/v1/chat"), true);
  assert.equal(isAuthRateLimited("/v1/runtime"), true);
  assert.equal(isAuthRateLimited("/v1/runtime/stream"), true);
});

void test("a trailing slash on an exact route still counts (P2-5)", () => {
  assert.equal(isAuthRateLimited("/v1/chat/"), true);
  assert.equal(isAuthRateLimited("/v1/runtime/"), true);
  assert.equal(isAuthRateLimited("/v1/runtime/stream/"), true);
});

void test("every route under /v1/byok/ counts, by prefix, not by an exact list", () => {
  assert.equal(isAuthRateLimited("/v1/byok/probe"), true);
  assert.equal(isAuthRateLimited("/v1/byok/probe/"), true, "a trailing slash must not bypass the BYOK prefix");
  assert.equal(isAuthRateLimited("/v1/byok/anything-future"), true, "new BYOK routes are covered without an edit here");
});

void test("authenticated reads and unrelated routes are NOT limited", () => {
  assert.equal(isAuthRateLimited("/v1/conversations"), false);
  assert.equal(isAuthRateLimited("/v1/conversations/abc/messages"), false);
  assert.equal(isAuthRateLimited("/v1/conversations/abc/routes"), false);
  assert.equal(isAuthRateLimited("/v1/users/profile"), false);
});

void test("a sibling path is not mistaken for a byok route by a naive substring check", () => {
  assert.equal(isAuthRateLimited("/v1/byoke/probe"), false);
  assert.equal(isAuthRateLimited("/v1/byok"), false, "the prefix requires the trailing slash boundary");
});
