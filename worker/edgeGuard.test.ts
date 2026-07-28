import test from "node:test";
import assert from "node:assert/strict";
import { isRateLimitPath, reclaimDelayMs } from "./edgeGuard.ts";

// P2-3 (issue #284 / Task 9): a per-identity rate-limit shard is reclaimed
// two windows after its last write so an abandoned identity's shard doesn't
// occupy storage forever. The daily budget shard is a fixed, separate DO
// instance (`idFromName("budget")`, costBreaker.ts) and never receives the
// `/rate-limit` pathname, so it can never be swept by this mechanism.

void test("only the /rate-limit pathname schedules a reclaim", () => {
  assert.equal(isRateLimitPath("/rate-limit"), true);
  assert.equal(isRateLimitPath("/budget"), false);
  assert.equal(isRateLimitPath("/"), false);
});

void test("the reclaim delay is exactly two windows out", () => {
  assert.equal(reclaimDelayMs(60), 120_000);
  assert.equal(reclaimDelayMs(1), 2_000);
});
