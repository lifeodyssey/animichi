/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered, with
 * its durable guard shards run by the guard object itself (`EdgeGuard`) over
 * in-memory storage that already holds a window for the identity. This file pins
 * what a turn (`POST /v1/chat`) answers when that stored window is broken.
 *
 * A stored window whose start or count is not a finite number is no window, so
 * the turn is judged on a new window and served. It is never refused with the
 * outage's 503 `rate_limit_unavailable`, nor limited by the broken count. A
 * window exactly as written is served as before.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/env.ts";
import { EdgeGuard } from "../src/protect/edge-guard.ts";
import { fakeStorage } from "./doubles/guard-doubles.ts";
import { ADMITTED, entrySeam, HUMAN, NOW, VISITOR } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";

/** A guard object over storage that holds `window`, as a shard that wrote it earlier would. */
function guardHolding(window: unknown): EdgeGuard {
  const storage = fakeStorage();
  storage.data.set("window", window);
  return new EdgeGuard({ storage: storage.state } as unknown as DurableObjectState, {});
}

/** A durable tier whose every shard holds `window`; the budget shard reads its own latch, which was never set. */
function shardsHolding(window: unknown): Env["EDGE_GUARD"] {
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: () => guardHolding(window),
  };
}

interface Served {
  readonly body: string;
  readonly log: readonly string[];
}

const SERVED: Readonly<Record<"a verified caller" | "an admitted visitor", Served>> = {
  "a verified caller": {
    body: '{"handler":"chat","user":"u1","type":"human","session":"-"}',
    log: ["auth u1", "coarse authed:u1", "tier chat u1 human -"],
  },
  "an admitted visitor": {
    body: `{"handler":"chat","user":"${VISITOR}","type":"anonymous","session":"-"}`,
    log: ["auth absent", `coarse ${VISITOR}`, `tier chat ${VISITOR} anonymous -`],
  },
};

const CALLERS = { "a verified caller": HUMAN, "an admitted visitor": ADMITTED };

interface StoredWindowTurn {
  readonly holds: string;
  readonly stored: unknown;
  readonly caller: keyof typeof SERVED;
}

const TURNS: readonly StoredWindowTurn[] = [
  { holds: "a window exactly as written", stored: { startedAtMs: NOW - 1_000, count: 1 }, caller: "a verified caller" },
  { holds: "a window with a NaN start", stored: { startedAtMs: Number.NaN, count: 1 }, caller: "a verified caller" },
  { holds: "a window with a NaN count", stored: { startedAtMs: NOW - 1_000, count: Number.NaN }, caller: "a verified caller" },
  { holds: "a window with an Infinity start", stored: { startedAtMs: Number.POSITIVE_INFINITY, count: 1 }, caller: "a verified caller" },
  { holds: "a window with a NaN start", stored: { startedAtMs: Number.NaN, count: 1 }, caller: "an admitted visitor" },
];

for (const turn of TURNS) {
  void test(`${turn.caller}'s turn, when its shard holds ${turn.holds}, is served`, async (t) => {
    const seam = entrySeam(t, UNLIMITED, { EDGE_GUARD: shardsHolding(turn.stored) });
    const response = await seam.send("POST", "/v1/chat", CALLERS[turn.caller]);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), SERVED[turn.caller].body);
    assert.deepEqual(seam.log, SERVED[turn.caller].log);
  });
}
