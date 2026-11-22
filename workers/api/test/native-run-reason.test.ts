import assert from "node:assert/strict";
import test from "node:test";
import { publicRunReason } from "../src/agent/views/history.ts";

const FAILED = { run_id: "01992000-0000-7000-8000-000000000141", status: "failed", reason: "cancelled" } as const;

void test("a deadline kill keeps the business reason the contract already publishes", () => {
  assert.deepEqual(publicRunReason(FAILED, "deadline_exceeded"), { run_id: FAILED.run_id, status: "failed", reason: "deadline_exceeded" });
});

void test("a business reason outside the published vocabulary stays internal", () => {
  assert.deepEqual(publicRunReason(FAILED, "quota_exhausted"), FAILED);
});

void test("a succeeded or still-running run keeps its own status and no business reason", () => {
  assert.equal(publicRunReason({ run_id: FAILED.run_id, status: "succeeded" }, "deadline_exceeded")?.reason, undefined);
  assert.deepEqual(publicRunReason({ run_id: FAILED.run_id, status: "running" }, "deadline_exceeded"), { run_id: FAILED.run_id, status: "running" });
  assert.equal(publicRunReason(null, "deadline_exceeded"), null);
});
