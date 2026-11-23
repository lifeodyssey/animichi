/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how today's gateway reads the two answers its durable guard shards
 * give a turn (`POST /v1/chat`): the rate verdict, and for a visitor the
 * day's budget latch. Each case's shards answer a literal body with 200, and
 * every call they get is written to the case's own list beside the seam's log.
 *
 * A rate verdict whose `allowed` is a boolean and whose `retryAfterSeconds` is
 * a number is taken, extra keys and all. Any other verdict is no verdict, which
 * the durable class turns into its outage answer: 503 `rate_limit_unavailable`,
 * before the budget latch is read or the agent tier is asked. A latch answer is
 * latched only when `latched` is `true`; a latched day answers a visitor's turn
 * with the budget guidance, byte for byte, and a verified caller's turn never
 * reads the latch.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/env.ts";
import { ADMITTED, entrySeam, HUMAN, VISITOR } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";
import { BUDGET_EXHAUSTED, RATE_LIMITED_17, RATE_LIMIT_UNAVAILABLE } from "./doubles/entry-envelopes.ts";

/** A durable tier whose every shard answers its path with a literal 200 JSON body, writing each call to `calls`. */
function literalShards(calls: string[], rate: string, budget: string): Env["EDGE_GUARD"] {
  const bodies = new Map([["/rate-limit", rate], ["/budget", budget]]);
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: (id) => ({
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        calls.push(`${String(id)} ${request.method} ${pathname}`);
        return Promise.resolve(new Response(bodies.get(pathname), { headers: { "Content-Type": "application/json" } }));
      },
    }),
  };
}

const CALLERS = { "a verified caller": HUMAN, "an admitted visitor": ADMITTED };

interface ShardReading {
  readonly when: string;
  readonly rate: string;
  readonly budget: string;
  readonly caller: keyof typeof CALLERS;
  readonly status: number;
  readonly body: string;
  readonly log: readonly string[];
  readonly calls: readonly string[];
}

const ALLOWED = '{"allowed":true,"retryAfterSeconds":0}';
const NOT_LATCHED = '{"latched":false}';
const LATCHED = '{"latched":true}';
const CALLER_RATE = ["rate:authed:u1 POST /rate-limit"];
const VISITOR_RATE = [`rate:${VISITOR} POST /rate-limit`];
const VISITOR_BOTH = [...VISITOR_RATE, "budget GET /budget"];
const CALLER_METERED = ["auth u1", "coarse authed:u1"];
const VISITOR_METERED = ["auth absent", `coarse ${VISITOR}`];
const CALLER_SERVED = '{"handler":"chat","user":"u1","type":"human","session":"-"}';
const VISITOR_SERVED = `{"handler":"chat","user":"${VISITOR}","type":"anonymous","session":"-"}`;

function outage(rate: string): ShardReading {
  return { when: `its shard answers ${rate}`, rate, budget: NOT_LATCHED, caller: "a verified caller", status: 503,
    body: RATE_LIMIT_UNAVAILABLE, log: CALLER_METERED, calls: CALLER_RATE };
}

const READINGS: readonly ShardReading[] = [
  { when: "its shard allows with an extra key", rate: '{"allowed":true,"retryAfterSeconds":0,"shard":"rate:authed:u1"}',
    budget: NOT_LATCHED, caller: "a verified caller", status: 200, body: CALLER_SERVED,
    log: [...CALLER_METERED, "tier chat u1 human -"], calls: CALLER_RATE },
  { when: "its shard denies for 17 s with an extra key", rate: '{"allowed":false,"retryAfterSeconds":17,"shard":"rate:authed:u1"}',
    budget: NOT_LATCHED, caller: "a verified caller", status: 429, body: RATE_LIMITED_17, log: CALLER_METERED, calls: CALLER_RATE },
  outage('{"allowed":true}'),
  outage('{"allowed":"true","retryAfterSeconds":0}'),
  outage('{"allowed":true,"retryAfterSeconds":"0"}'),
  outage('{"retryAfterSeconds":17}'),
  outage("[true,0]"),
  outage("null"),
  { when: 'its shard answers {"allowed":true}', rate: '{"allowed":true}', budget: NOT_LATCHED, caller: "an admitted visitor",
    status: 503, body: RATE_LIMIT_UNAVAILABLE, log: VISITOR_METERED, calls: VISITOR_RATE },
  { when: "the day is latched", rate: ALLOWED, budget: LATCHED, caller: "an admitted visitor", status: 403,
    body: BUDGET_EXHAUSTED, log: VISITOR_METERED, calls: VISITOR_BOTH },
  { when: "the day is latched with an extra key", rate: ALLOWED, budget: '{"latched":true,"dayKey":"2026-11-23"}',
    caller: "an admitted visitor", status: 403, body: BUDGET_EXHAUSTED, log: VISITOR_METERED, calls: VISITOR_BOTH },
  { when: 'the latch answers {"latched":"true"}', rate: ALLOWED, budget: '{"latched":"true"}', caller: "an admitted visitor",
    status: 200, body: VISITOR_SERVED, log: [...VISITOR_METERED, `tier chat ${VISITOR} anonymous -`], calls: VISITOR_BOTH },
  { when: "the day is latched", rate: ALLOWED, budget: LATCHED, caller: "a verified caller", status: 200, body: CALLER_SERVED,
    log: [...CALLER_METERED, "tier chat u1 human -"], calls: CALLER_RATE },
];

for (const reading of READINGS) {
  void test(`${reading.caller}'s turn, when ${reading.when}, answers ${String(reading.status)}`, async (t) => {
    const calls: string[] = [];
    const seam = entrySeam(t, UNLIMITED, { EDGE_GUARD: literalShards(calls, reading.rate, reading.budget) });
    const response = await seam.send("POST", "/v1/chat", CALLERS[reading.caller]);
    assert.equal(response.status, reading.status);
    assert.equal(await response.text(), reading.body);
    assert.deepEqual(seam.log, reading.log);
    assert.deepEqual(calls, reading.calls);
  });
}
