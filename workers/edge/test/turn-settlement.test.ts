/**
 * W1-6 (#1255): what one settled turn costs, and which day row it charges.
 *
 * Ported from the Python meter (`apps/agent`
 * `interfaces/usage_metering.py::usage_cost_usd`): per-million-token prices are
 * configuration, and an unpriced model still meters its tokens at zero cost.
 * The cases that are NOT Python's are the ones the money column forced —
 * `NUMERIC(14,6)` is counted in whole micro-USD and travels as text, so the
 * rounding boundary is asserted here rather than discovered in a day total.
 *
 * test-type: unit (pure functions, no database, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { settledRun, turnCostUsd } from "../src/agent/settlement/turn-settlement.ts";
import { RUN_PAYERS } from "../src/db/schema.ts";

/** Shaped like the deployed model's own pricing: cheap in, dearer out. */
const PRICES = { inputUsdPerMtok: 0.3, outputUsdPerMtok: 1.2 };

void test("a turn is priced per million tokens, in whole micro-USD", () => {
  const usage = { requests: 1, inputTokens: 12_000, outputTokens: 3_000 };
  assert.equal(turnCostUsd(usage, PRICES), "0.007200");
});

void test("an unpriced model still meters its tokens, at zero cost", () => {
  const usage = { requests: 1, inputTokens: 900_000, outputTokens: 100_000 };
  assert.equal(turnCostUsd(usage, { inputUsdPerMtok: 0, outputUsdPerMtok: 0 }), "0.000000");
});

void test("a turn past a whole dollar keeps its dollars and its micro-USD apart", () => {
  const usage = { requests: 4, inputTokens: 5_000_000, outputTokens: 1_000_000 };
  assert.equal(turnCostUsd(usage, PRICES), "2.700000");
});

void test("a sub-micro-USD turn rounds to the nearest micro-USD", () => {
  const rounded = turnCostUsd({ requests: 1, inputTokens: 3, outputTokens: 0 }, PRICES);
  const vanished = turnCostUsd({ requests: 1, inputTokens: 1, outputTokens: 0 }, PRICES);
  assert.equal(rounded, "0.000001");
  assert.equal(vanished, "0.000000");
});

void test("the day row a settled turn charges is the run's own payer", () => {
  const charged = RUN_PAYERS.map((payer) => settledRun({ scope: payer, cost_usd: "0.001000" }).scope);
  assert.deepEqual(charged, [...RUN_PAYERS]);
});

void test("a settled turn banks the money that landed on the run, as the driver's text", () => {
  assert.deepEqual(settledRun({ scope: "anon", cost_usd: "0.002470" }), {
    scope: "anon",
    costUsd: "0.002470",
  });
});

void test("a payer outside the usage-scope domain is refused, not banked", () => {
  assert.throws(() => settledRun({ scope: "sponsor", cost_usd: "0.000000" }), /readable payer and cost/);
});

void test("a cost that is not the driver's decimal text is refused, not banked", () => {
  assert.throws(() => settledRun({ scope: "anon", cost_usd: 0.42 }), /readable payer and cost/);
});
