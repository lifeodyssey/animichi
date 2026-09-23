import { afterEach, describe, expect, it } from "vitest";
import { applyLockRuntime } from "./apply-lock-workerd";
import { applySpec } from "./recorded-apply";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { WORKERD_SLOW_APPLY_BUDGET_MS } from "./test-timeout-budget";

/* What the DEPLOYED `MigratorApplyLock` does, in a real workerd runtime with a real Durable
 * Object (#1868). The class is bundled from `src/` unchanged; only the apply it runs is the
 * test's. The two facts this file owns are the two the outage turned on: applies are still
 * serialized, and an apply is no longer cut off at half a minute.
 *
 * The predecessor of this file matched `src/apply-lock.ts` for the string
 * "blockConcurrencyWhile" — it pinned the construct that caused the outage, and nothing about
 * its behaviour. Both assertions below fail if the construct comes back.
 */

/** Cloudflare's documented `blockConcurrencyWhile` timeout, and what this runtime enforces:
 * a 35 s callback was cancelled at 30.0 s here with the message staging logged on 2026-09-22,
 * while the same 35 s outside the callback returned normally. */
const PLATFORM_CALLBACK_CAP_MS = 30_000;
const LONGER_THAN_THE_CAP_MS = 32_000;

const success = { settled: true, outcome: { kind: "success", exitCode: 0 } };

let runtime: Awaited<ReturnType<typeof applyLockRuntime>>["runtime"] | undefined;
afterEach(async () => { await runtime?.dispose(); });

describe("the fixed apply lock, in workerd", { timeout: WORKERD_SLOW_APPLY_BUDGET_MS }, () => {
  pinsSuiteBudget(WORKERD_SLOW_APPLY_BUDGET_MS);

  it("starts the second apply only once the first has finished", async () => {
    const lock = await applyLockRuntime();
    runtime = lock.runtime;
    // Both RPCs are issued in one tick, the second while the first is still inside its apply.
    const report = await lock.applies(applySpec("first", 400), applySpec("second", 0));
    expect(report.crossings).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(report.applies).toEqual([success, success]);
  });

  it("returns an apply that runs for longer than the platform caps a blocked callback", async () => {
    const lock = await applyLockRuntime();
    runtime = lock.runtime;
    const report = await lock.applies(applySpec("long", LONGER_THAN_THE_CAP_MS));
    // Without the elapsed assertion an apply that returned at once would satisfy the next one.
    expect(report.elapsedMs).toBeGreaterThan(PLATFORM_CALLBACK_CAP_MS);
    expect(report.applies).toEqual([success]);
  });
});
