/**
 * SUT: the budget latch read, `budgetLatched` (`src/protect/cost-breaker.ts`),
 * and how it reads the budget shard's reply. The shard answers
 * `{"latched":true}` or `{"latched":false}` (`handleBudget` in
 * `src/protect/edge-guard.ts`). The read parses that reply: only an object whose
 * `latched` is the literal `true` reads as latched, an extra key included, and
 * any other JSON reads as not latched. Each case's shard answers a literal body
 * with 200.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { budgetLatched } from "../src/protect/cost-breaker.ts";
import type { GuardNamespace } from "../src/protect/guard-store.ts";

const DAY = "2026-11-24";

/** A guard whose every shard answers `body` with 200. */
function answering(body: string): GuardNamespace {
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.resolve(new Response(body, { headers: { "Content-Type": "application/json" } })) }),
  };
}

const LATCHED_REPLIES = ['{"latched":true}', '{"latched":true,"dayKey":"2026-11-24"}'];

const UNLATCHED_REPLIES = [
  '{"latched":false}', '{"latched":"true"}', '{"latched":1}', '{"latched":{}}', "{}", '"true"', "true", "1", "[true]", "null",
];

for (const body of LATCHED_REPLIES) {
  void test(`a budget shard reply of ${body} reads as latched`, async () => {
    assert.equal(await budgetLatched(answering(body), DAY), true);
  });
}

for (const body of UNLATCHED_REPLIES) {
  void test(`a budget shard reply of ${body} reads as not latched`, async () => {
    assert.equal(await budgetLatched(answering(body), DAY), false);
  });
}
