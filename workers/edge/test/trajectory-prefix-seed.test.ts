/**
 * E-1 (#1380): what a frozen trajectory prefix actually writes, and the three
 * things it refuses.
 *
 * The write seams are the production doubles, so what is asserted here is the
 * rows themselves — one settled `run_steps` row carrying its result, the
 * assistant message that issued it, a run driven to `succeeded`, and the
 * envelope the next turn reads its open question out of.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionOwnershipError } from "../src/agent/intake/turn-intake.ts";
import { frozenSummaryOf } from "../src/agent/session/frozen-tool-return.ts";
import { TOOL_RETURN_MAX_CHARS } from "../src/agent/session/tool-return-summary.ts";
import { seedTrajectoryPrefix, SessionNotEmptyError } from "../src/agent/session/prefix-seeding.ts";
import { prefixMessageKey } from "../src/agent/session/prefix-turn.ts";
import { makePrefixSeeding, makeSessionFacts, SEEDED_RUN_ID } from "./doubles/make-prefix-seeding.ts";
import {
  makePrefixSeedingRequest,
  makeTrajectoryPrefix,
  SEEDED_CLARIFICATION_ID,
} from "./doubles/make-trajectory-prefix.ts";

void test("a seeded prefix settles one run_steps row with its result and its issuing message", async () => {
  const harness = makePrefixSeeding();
  const request = makePrefixSeedingRequest();

  const receipt = await seedTrajectoryPrefix(harness.parts, request);

  assert.equal(receipt.seeded, true);
  assert.equal(harness.store.written.length, 1);
  const step = harness.store.written.at(0);
  assert.ok(step !== undefined, "one step was written");
  assert.equal(step.toolName, "resolve_anime");
  assert.deepEqual(step.result.content, [{ type: "text", text: request.prefix.toolCall.resultText }]);
  assert.equal(step.toolCallMessage?.run_id, SEEDED_RUN_ID);
});

void test("the seeded run reaches its terminal row rather than staying running", async () => {
  const harness = makePrefixSeeding();

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest());

  assert.equal(harness.store.succeeded.length, 1);
  assert.equal(harness.store.succeeded.at(0)?.answer, "どちらの作品ですか？");
  assert.deepEqual(harness.store.failed, []);
});

void test("the seeded user message carries the case id as its dedupe key", async () => {
  const harness = makePrefixSeeding();
  const request = makePrefixSeedingRequest();

  await seedTrajectoryPrefix(harness.parts, request);

  assert.equal(harness.opened.length, 1);
  const submission = harness.opened.at(0)?.submission;
  assert.ok(submission !== undefined, "one turn was opened");
  assert.equal(submission.clientMessageId, prefixMessageKey(request.prefix.caseId));
  assert.equal(submission.text, request.prefix.userText);
});

void test("the envelope read back carries the pending clarification field for field", async () => {
  const harness = makePrefixSeeding();
  const request = makePrefixSeedingRequest();

  await seedTrajectoryPrefix(harness.parts, request);

  const { pendingClarification } = await harness.parts.envelopes.load();
  assert.ok(pendingClarification !== null, "the seeded question was stored");
  assert.equal(pendingClarification.id, SEEDED_CLARIFICATION_ID);
  assert.equal(pendingClarification.reason, "anime_ambiguity");
  assert.deepEqual(pendingClarification.candidates, request.prefix.pendingClarification?.candidates);
});

void test("the seeded clarification id is also the session's revision, so the next question is greater", async () => {
  const harness = makePrefixSeeding();

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest());

  const envelope = await harness.parts.envelopes.load();
  assert.equal(envelope.clarificationRevision, SEEDED_CLARIFICATION_ID);
  assert.equal(envelope.withClarification("place_ambiguity", []).pendingClarification?.id, SEEDED_CLARIFICATION_ID + 1);
});

void test("the envelope is staged under the run before it is promoted to the session", async () => {
  const harness = makePrefixSeeding();

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest());

  const keys = harness.storage.writes.map((write) => write.key);
  assert.deepEqual(keys, [`envelope:pending:${SEEDED_RUN_ID}`, "envelope"]);
  assert.deepEqual(harness.storage.keys, ["envelope"]);
});

void test("a session owned by another identity is refused, and nothing is opened", async () => {
  const harness = makePrefixSeeding({ facts: makeSessionFacts(0, "someone-else") });

  await assert.rejects(
    seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest()),
    (error: unknown) => error instanceof SessionOwnershipError,
  );
  assert.deepEqual(harness.opened, []);
});

void test("an unowned session is refused on the same terms as another identity's", async () => {
  const harness = makePrefixSeeding({ facts: makeSessionFacts(0, null as unknown as string) });

  await assert.rejects(
    seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest()),
    (error: unknown) => error instanceof SessionOwnershipError,
  );
});

void test("a session that has already taken a turn is refused, and nothing is written", async () => {
  const harness = makePrefixSeeding({ facts: makeSessionFacts(1), carriesPrefix: false });

  await assert.rejects(
    seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest()),
    (error: unknown) => error instanceof SessionNotEmptyError,
  );
  assert.deepEqual(harness.opened, []);
  assert.deepEqual(harness.storage.writes, []);
});

void test("re-seeding the same case answers seeded:false and writes nothing", async () => {
  const harness = makePrefixSeeding({ facts: makeSessionFacts(1), carriesPrefix: true });

  const receipt = await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest());

  assert.equal(receipt.seeded, false);
  assert.deepEqual(harness.opened, []);
  assert.deepEqual(harness.store.written, []);
});

void test("an intake replay is the second idempotency guard: no step, no settlement", async () => {
  const harness = makePrefixSeeding({ replayed: true });

  const receipt = await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest());

  assert.equal(receipt.seeded, false);
  assert.deepEqual(harness.store.written, []);
  assert.deepEqual(harness.store.succeeded, []);
});

void test("a prefix that leaves no open question seeds a session with an empty envelope", async () => {
  const harness = makePrefixSeeding();
  const prefix = makeTrajectoryPrefix({ pendingClarification: null, currentAnime: { bangumiId: "115908", title: "Sound Euphonium" } });

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest({ prefix }));

  const envelope = await harness.parts.envelopes.load();
  assert.equal(envelope.pendingClarification, null);
  assert.deepEqual(envelope.currentAnime, { bangumiId: "115908", title: "Sound Euphonium" });
});

/** A `resolve_anime` answer over `TOOL_RETURN_MAX_CHARS` — the size a real
 * catalog return has and the five derived cases happen not to reach. */
function makeLongResult(): string {
  const candidates = Array.from({ length: 40 }, (_, index) => ({ id: `1159${String(index)}`, title: `Work ${String(index)}` }));
  return JSON.stringify({ status: "ambiguous", candidates });
}

void test("a return over the cap is persisted with the frozen short form beside it", async () => {
  const harness = makePrefixSeeding();
  const base = makeTrajectoryPrefix();
  const resultText = makeLongResult();
  const prefix = makeTrajectoryPrefix({ toolCall: { ...base.toolCall, resultText } });

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest({ prefix }));

  const step = harness.store.written.at(0);
  assert.ok(step?.result.summary !== undefined, "the long return was frozen at write time");
  assert.ok(resultText.length > TOOL_RETURN_MAX_CHARS, "the case is about a return over the cap");
  assert.ok(step.result.summary.length < resultText.length);
});

void test("the frozen form is one no later reader would summarise again", async () => {
  const harness = makePrefixSeeding();
  const base = makeTrajectoryPrefix();
  const prefix = makeTrajectoryPrefix({ toolCall: { ...base.toolCall, resultText: makeLongResult() } });

  await seedTrajectoryPrefix(harness.parts, makePrefixSeedingRequest({ prefix }));

  const summary = harness.store.written.at(0)?.result.summary;
  assert.ok(summary !== undefined, "the long return was frozen at write time");
  assert.equal(frozenSummaryOf(prefix.toolCall.toolName, [{ type: "text", text: summary }]), undefined);
});
