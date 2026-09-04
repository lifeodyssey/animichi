/**
 * W1-4 (#1253) staging lane: what the catalog tools' hop looks like from
 * OUTSIDE a deployed Worker — which is to say, invisible, by design.
 *
 * Read `api-test/README.md` first: the four procedures ride the private
 * `CATALOG` service binding, so they have no public door and this lane asserts
 * that rather than pretending to call them. Opt-in and fail-closed: without
 * `CATALOG_API_ORIGIN` it refuses to run at all.
 *
 * test-type: api (real network against a deployed origin).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { laneOrigin as origin } from "./lane-origin.ts";

/** How long this whole lane may spend waiting on staging. One deadline, shared
 * by every request it makes: a staging origin that accepts a connection and
 * then says nothing would otherwise hang the lane forever — node:test imposes
 * no timeout of its own, and an operator running this by hand deserves a
 * failure rather than a prompt that never returns. */
const LANE_DEADLINE_MS = 15_000;
const laneDeadline = AbortSignal.timeout(LANE_DEADLINE_MS);

/** The catalog procedures the four tools call. */
const TOOL_PROCEDURES = ["resolve", "points-by-bangumi-id", "nearby", "geocode", "itinerary"];

/** POST one procedure at the public origin, as an attacker would. */
async function publicAttempt(procedure: string): Promise<number> {
  const response = await fetch(`${origin()}/catalog/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: laneDeadline,
  });
  return response.status;
}

void test("the deployed origin is alive", async () => {
  const response = await fetch(`${origin()}/healthz`, { signal: laneDeadline });
  assert.equal(response.status, 200);
});

void test("no catalog procedure the tools call is reachable by URL (Appendix D)", async () => {
  const statuses = await Promise.all(TOOL_PROCEDURES.map(publicAttempt));
  // 404 exactly, not merely "not 200": a WAF challenge would answer 403 to
  // everything and make this assertion vacuous. 404 is the web Worker saying
  // no route here, which is what "the catalog has no public door" looks like.
  assert.deepEqual(statuses, TOOL_PROCEDURES.map(() => 404));
});
