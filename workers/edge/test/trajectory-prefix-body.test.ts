/**
 * E-1 (#1380): the edge's guarded read of a seeding body agrees with the zod
 * declaration the harness sends it by.
 *
 * There are two readers of one shape and there have to be: the Node harness
 * validates with `@animichi/contract`'s zod, and the Worker may not load zod at
 * all (#1285), so `trajectory-prefix.ts` re-reads the body by hand. This file
 * is what stops the two from drifting — the SAME body is parsed by both, and a
 * member either side stopped reading shows up here rather than on staging.
 *
 * The refusals are the other half. A body this module can only read PARTLY is
 * refused whole: a half-seeded starting point would be measured as if it were a
 * complete one, and the ids a reply is validated against are exactly what a
 * trimmed candidate list would silently change.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SeedTrajectoryPrefixRequest } from "@animichi/contract/staging-prefix-contract";
import { trajectoryPrefixIn } from "../src/agent/session/trajectory-prefix.ts";
import { makePrefixBody, makeTrajectoryPrefix } from "./doubles/make-trajectory-prefix.ts";

/** One body with a single member replaced by what a case is about. */
function bodyWith(member: string, value: unknown): unknown {
  return { ...(makePrefixBody() as Record<string, unknown>), [member]: value };
}

void test("a body the contract accepts is read whole by the edge", () => {
  const body = makePrefixBody();

  assert.equal(SeedTrajectoryPrefixRequest.safeParse(body).success, true);
  assert.deepEqual(trajectoryPrefixIn(body), makeTrajectoryPrefix());
});

void test("the tool call's params arrive as the JSON text the wire carries", () => {
  const read = trajectoryPrefixIn(makePrefixBody());
  assert.ok(read !== null, "the body was read whole");

  assert.deepEqual(read.toolCall.params, { title: "響け！ユーフォニアム" });
  assert.deepEqual(read.toolCall.resultDetails, { status: "ambiguous" });
});

void test("params that are not JSON, and params that are not an object, are refused", () => {
  const notJson = bodyWith("tool_call", { tool_name: "resolve_anime", params: "{", result_text: "x" });
  const notObject = bodyWith("tool_call", { tool_name: "resolve_anime", params: "42", result_text: "x" });

  assert.equal(trajectoryPrefixIn(notJson), null);
  assert.equal(trajectoryPrefixIn(notObject), null);
});

void test("a candidate missing its id refuses the whole clarification, not just that row", () => {
  const body = bodyWith("pending_clarification", {
    id: 7,
    reason: "anime_ambiguity",
    candidates: [{ id: "115908", title: "Sound Euphonium" }, { title: "no id" }],
  });

  assert.equal(trajectoryPrefixIn(body), null);
});

void test("a candidate whose optional member has the wrong type is refused", () => {
  const body = bodyWith("pending_clarification", {
    id: 7,
    reason: "anime_ambiguity",
    candidates: [{ id: "seed:uji", title: "宇治", lat: "34.88" }],
  });

  assert.equal(trajectoryPrefixIn(body), null);
});

void test("a clarification id that is not a positive integer names no question", () => {
  const zero = bodyWith("pending_clarification", { id: 0, reason: "anime_ambiguity", candidates: [{ id: "a", title: "A" }] });

  assert.equal(trajectoryPrefixIn(zero), null);
  assert.equal(SeedTrajectoryPrefixRequest.safeParse(zero).success, false);
});

void test("a prefix with no open question and no resolved work is a readable prefix", () => {
  const body = { ...(makePrefixBody() as Record<string, unknown>), pending_clarification: null };

  const read = trajectoryPrefixIn(body);
  assert.ok(read !== null, "a prefix without an open question is still a prefix");

  assert.equal(SeedTrajectoryPrefixRequest.safeParse(body).success, true);
  assert.equal(read.pendingClarification, null);
});

void test("a body missing the case id is refused: nothing could be deduped on", () => {
  const body = { ...(makePrefixBody() as Record<string, unknown>) };
  delete body.case_id;

  assert.equal(trajectoryPrefixIn(body), null);
  assert.equal(SeedTrajectoryPrefixRequest.safeParse(body).success, false);
});
