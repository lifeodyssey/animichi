/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's charge to a caller's limiter budget by what a FOLLOW-UP
 * request gets: each sequence gives one key a single slot, sends a request that
 * should or should not spend it, then shows whether the next request still had
 * it. The limiter doubles meter per key, as the ratelimit binding and the
 * durable shards do.
 *
 * Refusals before the limiter (a credential refusal, a 404 or 405, an unsolved
 * challenge, an undeclared catalog parameter) spend nothing; an OPTIONS to the
 * users prefix that carries a bearer spends a write slot. One caller's turn,
 * probe, users writes and adoption share a single window; a visitor's window is
 * its own; catalog readers share one damper slot per address.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, AID, entrySeam, HUMAN, VISITOR } from "./doubles/entry-seam.ts";
import type { LimiterPlan } from "./doubles/entry-seam-limiters.ts";

type Step = readonly [method: string, path: string, headers: Readonly<Record<string, string>>, status: number];

interface Sequence {
  readonly shows: string;
  readonly plan: LimiterPlan;
  readonly steps: readonly Step[];
  readonly log: readonly string[];
}

const ONE_WRITE: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: 1 };
const ONE_READ: LimiterPlan = { coarse: 1, durable: Number.POSITIVE_INFINITY };
const USERS = "/v1/users/saved-routes";
const POPULAR = "/catalog/public/popular";
const WRITE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const VISITOR_WRITE = ["auth absent", `coarse ${VISITOR}`, `rate:${VISITOR} POST /rate-limit`];
const VISITOR_TURN = [...VISITOR_WRITE, "budget GET /budget", `tier chat ${VISITOR} anonymous -`];
const FROM_A = { "CF-Connecting-IP": "203.0.113.7" };
const FROM_B = { "CF-Connecting-IP": "198.51.100.9" };

const SEQUENCES: readonly Sequence[] = [
  { shows: "a refused credential spends none of the write budget", plan: ONE_WRITE,
    steps: [["POST", USERS, {}, 401], ["POST", USERS, HUMAN, 200], ["POST", USERS, HUMAN, 429]],
    log: ["auth absent", ...WRITE, `users POST ${USERS} as u1/human`, ...WRITE] },
  { shows: "a preflight to the turn spends none of it", plan: ONE_WRITE,
    steps: [["OPTIONS", "/v1/chat", HUMAN, 404], ["POST", "/v1/chat", HUMAN, 200], ["POST", "/v1/chat", HUMAN, 429]],
    log: [...WRITE, "tier chat u1 human -", ...WRITE] },
  { shows: "an OPTIONS to users that carries a bearer spends all of it", plan: ONE_WRITE,
    steps: [["OPTIONS", USERS, HUMAN, 200], ["POST", USERS, HUMAN, 429]],
    log: [...WRITE, `users OPTIONS ${USERS} as u1/human`, ...WRITE] },
  { shows: "an unknown route under the BYOK prefix spends none of it", plan: ONE_WRITE,
    steps: [["POST", "/v1/byok/other", HUMAN, 404], ["POST", "/v1/byok/probe", HUMAN, 200], ["POST", "/v1/byok/probe", HUMAN, 429]],
    log: [...WRITE, "tier probe u1 human -", ...WRITE] },
  { shows: "adoption's method gate spends none of it", plan: ONE_WRITE,
    steps: [["GET", "/v1/sessions/adopt", HUMAN, 405], ["POST", "/v1/sessions/adopt", HUMAN, 200],
      ["POST", "/v1/sessions/adopt", HUMAN, 429]],
    log: [...WRITE, ...WRITE] },
  { shows: "a verified users read spends none of it", plan: ONE_WRITE,
    steps: [["GET", USERS, HUMAN, 200], ["POST", USERS, HUMAN, 200], ["POST", USERS, HUMAN, 429]],
    log: ["auth u1", `users GET ${USERS} as u1/human`, ...WRITE, `users POST ${USERS} as u1/human`, ...WRITE] },
  { shows: "the turn, the probe, users writes and adoption share one window", plan: ONE_WRITE,
    steps: [["POST", "/v1/chat", HUMAN, 200], ["POST", "/v1/byok/probe", HUMAN, 429], ["POST", USERS, HUMAN, 429],
      ["POST", "/v1/sessions/adopt", HUMAN, 429]],
    log: [...WRITE, "tier chat u1 human -", ...WRITE, ...WRITE, ...WRITE] },
  { shows: "a visitor's window is not a verified caller's", plan: ONE_WRITE,
    steps: [["POST", "/v1/chat", ADMITTED, 200], ["POST", "/v1/chat", HUMAN, 200], ["POST", "/v1/chat", ADMITTED, 429]],
    log: [...VISITOR_TURN, ...WRITE, "tier chat u1 human -", ...VISITOR_WRITE] },
  { shows: "an unsolved challenge spends none of the visitor's window", plan: ONE_WRITE,
    steps: [["POST", "/v1/chat", { Cookie: AID }, 403], ["POST", "/v1/chat", ADMITTED, 200], ["POST", "/v1/chat", ADMITTED, 429]],
    log: ["auth absent", "turnstile -", ...VISITOR_TURN, ...VISITOR_WRITE] },
  { shows: "an undeclared catalog parameter spends none of the reader's damper", plan: ONE_READ,
    steps: [["GET", `${POPULAR}?spoof=1`, {}, 400], ["GET", POPULAR, {}, 200], ["GET", POPULAR, {}, 429]],
    log: ["coarse public-read", `catalog GET ${POPULAR}`, "coarse public-read"] },
  { shows: "catalog readers share one damper slot per address", plan: ONE_READ,
    steps: [["GET", POPULAR, FROM_A, 200], ["GET", "/catalog/public/anime-overview/3302", FROM_A, 429], ["GET", POPULAR, FROM_B, 200]],
    log: ["coarse ip:203.0.113.7", `catalog GET ${POPULAR}`, "coarse ip:203.0.113.7", "coarse ip:198.51.100.9", `catalog GET ${POPULAR}`] },
  { shows: "the coarse damper denies a write before its durable shard is asked", plan: { coarse: 1, durable: Number.POSITIVE_INFINITY },
    steps: [["POST", USERS, HUMAN, 200], ["POST", USERS, HUMAN, 429]],
    log: [...WRITE, `users POST ${USERS} as u1/human`, "auth u1", "coarse authed:u1"] },
];

for (const sequence of SEQUENCES) {
  void test(`a follow-up request shows ${sequence.shows}`, async (t) => {
    const seam = entrySeam(t, sequence.plan);
    const statuses: number[] = [];
    for (const [method, path, headers] of sequence.steps) statuses.push((await seam.send(method, path, headers)).status);
    assert.deepEqual(statuses, sequence.steps.map((step) => step[3]));
    assert.deepEqual(seam.log, sequence.log);
  });
}
