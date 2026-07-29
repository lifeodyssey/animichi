import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANON_BUDGET_EXHAUSTED_CODE,
  ANON_QUOTA_EXHAUSTED_CODE,
  AnonQuotaExhaustedData,
} from "../src/error-registry.js";

const WORKER_BREAKER = fileURLToPath(new URL("../../../worker/costBreaker.ts", import.meta.url));

describe("anonymous-limit wire codes", () => {
  it("pins the literals every tier has to agree on", () => {
    expect(ANON_BUDGET_EXHAUSTED_CODE).toBe("anon_budget_exhausted");
    expect(ANON_QUOTA_EXHAUSTED_CODE).toBe("anon_quota_exhausted");
  });

  it("keeps the two limits distinct so one banner cannot answer for the other", () => {
    expect(ANON_QUOTA_EXHAUSTED_CODE).not.toBe(ANON_BUDGET_EXHAUSTED_CODE);
  });

  it("stays in lockstep with the worker's breaker mirror", () => {
    const worker = readFileSync(WORKER_BREAKER, "utf8");
    expect(worker).toContain(`"${ANON_BUDGET_EXHAUSTED_CODE}"`);
  });
});

describe("anonymous quota rejection payload", () => {
  it("accepts an offset-bearing ISO reset instant", () => {
    const parsed = AnonQuotaExhaustedData.parse({ quota_resets_at: "2026-07-29T00:00:00Z" });
    expect(parsed.quota_resets_at).toBe("2026-07-29T00:00:00Z");
  });

  it("rejects a bare date, which cannot name an instant the client can wait for", () => {
    expect(AnonQuotaExhaustedData.safeParse({ quota_resets_at: "2026-07-29" }).success).toBe(false);
  });

  it("requires the reset instant — a lock with no exit is the bug it prevents", () => {
    expect(AnonQuotaExhaustedData.safeParse({}).success).toBe(false);
  });
});
