import test from "node:test";
import assert from "node:assert/strict";
import { WAKE_INTERVAL_MS } from "../src/agent/host/wake-interval.ts";

void test("the production session recovery cadence stays a 30-second scan", () => {
  assert.equal(WAKE_INTERVAL_MS, 30_000);
});
