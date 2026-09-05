/**
 * W1-5 (#1254): `ConversationRetrieval`, the "取回面" of spec §二 — what a
 * client that left mid-turn gets when it comes back and pulls the session once
 * by id.
 *
 * The transcript half is a PORT of the Python use case
 * (`apps/agent/src/animichi/application/get_session_history.py`), so the
 * assertions below are its own: the ordering authority is this module and not
 * the store (the transcript here arrives shuffled, exactly as the Python seam
 * test shuffles it), missing and forbidden conversations collapse to the same
 * absent answer so ownership is not observable, and the page/`next_offset`
 * arithmetic is the same bounded window.
 *
 * The run half is new: the state of the session's latest run, which is the one
 * field §三 adds to this surface.
 *
 * test-type: unit (in-memory records, no database, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readConversation,
  type ConversationFacts,
  type ConversationRecords,
  type TranscriptRow,
} from "../src/agent/retrieval/conversation-retrieval.ts";

const OWNER = "user-1";
const SESSION = "s-1";
const RUN_ID = "0199ab00-1111-7000-8000-000000000001";

function makeRow(createdAt: string, content: string): TranscriptRow {
  return { role: "user", content, responseData: null, createdAt };
}

/** The assistant row of the Python seam test, envelope and all. */
function makeAssistantRow(createdAt: string): TranscriptRow {
  return {
    role: "assistant",
    content: "ルートを作成しました。",
    responseData: { intent: "search_bangumi", success: true },
    createdAt,
  };
}

function makeFacts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { ownerId: OWNER, turnCount: 0, latestRun: null, ...overrides };
}

/** Records that answer with one session's facts and one shuffled transcript.
 * The settled steps are `settled-step-params.test.ts`'s subject, not this
 * file's, so a session here has none. */
function makeRecords(facts: ConversationFacts | null, rows: TranscriptRow[]): ConversationRecords {
  return {
    factsOf: () => Promise.resolve(facts),
    transcriptOf: (_sessionId, page) =>
      Promise.resolve(rows.slice(page.offset, page.offset + page.limit)),
    settledStepsOf: () => Promise.resolve([]),
  };
}

/** The three-row transcript of the Python seam test, out of order. */
function shuffledTranscript(): TranscriptRow[] {
  return [
    makeAssistantRow("2026-08-01T12:00:00Z"),
    makeRow("2026-08-01T10:00:00Z", "first"),
    makeRow("2026-08-01T11:00:00Z", "second"),
  ];
}

function readOwned(facts: ConversationFacts | null, rows: TranscriptRow[]) {
  return readConversation(makeRecords(facts, rows), { sessionId: SESSION, identityId: OWNER });
}

void test("the transcript is ordered by created_at ascending, whatever order the store returns", async () => {
  const page = await readOwned(makeFacts(), shuffledTranscript());
  assert.deepEqual(page?.messages.map((message) => message.content), [
    "first",
    "second",
    "ルートを作成しました。",
  ]);
});

void test("an assistant row keeps its intent envelope", async () => {
  const page = await readOwned(makeFacts(), shuffledTranscript());
  assert.deepEqual(page?.messages[2], {
    role: "assistant",
    content: "ルートを作成しました。",
    response_data: { intent: "search_bangumi", success: true },
    created_at: "2026-08-01T12:00:00Z",
  });
});

void test("an envelope that is not an object at all reads as no envelope", async () => {
  const row: TranscriptRow = { ...makeRow("2026-08-01T10:00:00Z", "x"), responseData: "not json" };
  const page = await readOwned(makeFacts(), [row]);
  assert.equal(page?.messages[0]?.response_data, null);
});

void test("an envelope carrying wrong-typed members reads them as absent, not as themselves", async () => {
  const responseData = { intent: 7, success: true };
  const row: TranscriptRow = { ...makeRow("2026-08-01T10:00:00Z", "x"), responseData };
  const page = await readOwned(makeFacts(), [row]);
  assert.deepEqual(page?.messages[0]?.response_data, { intent: null, success: true });
});

void test("an envelope carrying neither member publishes none at all", async () => {
  const responseData = { selection: { of: "points", pointIds: ["p1"], origin: null, locale: "ja" } };
  const row: TranscriptRow = { ...makeRow("2026-08-01T10:00:00Z", "x"), responseData };
  const page = await readOwned(makeFacts(), [row]);
  assert.equal(page?.messages[0]?.response_data, null);
});

void test("a session that does not exist is absent", async () => {
  assert.equal(await readOwned(null, []), null);
});

void test("a session owned by someone else collapses to the same absent answer", async () => {
  const facts = makeFacts({ ownerId: "user-2" });
  assert.equal(await readOwned(facts, shuffledTranscript()), null);
});

void test("a session nobody owns is not readable by an identity that guessed its id", async () => {
  assert.equal(await readOwned(makeFacts({ ownerId: null }), []), null);
});

void test("revision is the number of turns the session has committed", async () => {
  const page = await readOwned(makeFacts({ turnCount: 7 }), []);
  assert.equal(page?.revision, 7);
});

void test("a session with no run yet answers an explicit null run", async () => {
  const page = await readOwned(makeFacts(), shuffledTranscript());
  assert.equal(page?.run, null);
});

void test("a running turn is reported as running, with no reason", async () => {
  const latestRun = { runId: RUN_ID, status: "running" as const, failureReason: null };
  const page = await readOwned(makeFacts({ latestRun }), []);
  assert.deepEqual(page?.run, { run_id: RUN_ID, status: "running", reason: null });
});

void test("a succeeded turn is reported as succeeded", async () => {
  const latestRun = { runId: RUN_ID, status: "succeeded" as const, failureReason: null };
  const page = await readOwned(makeFacts({ latestRun }), []);
  assert.deepEqual(page?.run, { run_id: RUN_ID, status: "succeeded", reason: null });
});

void test("a failed turn is reported as failed, carrying why it failed", async () => {
  const latestRun = { runId: RUN_ID, status: "failed" as const, failureReason: "deadline_exceeded" as const };
  const page = await readOwned(makeFacts({ latestRun }), []);
  assert.deepEqual(page?.run, { run_id: RUN_ID, status: "failed", reason: "deadline_exceeded" });
});

void test("a full page names the next offset; the final page names none", async () => {
  const rows = [1, 2, 3].map((n) => makeRow(`2026-08-01T0${String(n)}:00:00Z`, `m${String(n)}`));
  const records = makeRecords(makeFacts(), rows);
  const request = { sessionId: SESSION, identityId: OWNER, limit: 2, offset: 0 };
  const first = await readConversation(records, request);
  const second = await readConversation(records, { ...request, offset: 2 });
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.next_offset, 2);
  assert.deepEqual(first.messages.map((message) => message.content), ["m1", "m2"]);
  assert.equal(second.next_offset, null);
  assert.deepEqual(second.messages.map((message) => message.content), ["m3"]);
});

/** Records with more transcript than any page can hold: every page is full. */
function makeEndlessRecords(): ConversationRecords {
  return {
    factsOf: () => Promise.resolve(makeFacts()),
    transcriptOf: (_sessionId, page) =>
      Promise.resolve(Array.from({ length: page.limit }, () => makeRow("2026-08-01T10:00:00Z", "m"))),
    settledStepsOf: () => Promise.resolve([]),
  };
}

void test("a full page below the offset bound still names the next offset", async () => {
  const request = { sessionId: SESSION, identityId: OWNER, limit: 1, offset: 998 };
  assert.equal((await readConversation(makeEndlessRecords(), request))?.next_offset, 999);
});

void test("a full page whose next offset is past the route's bound names none", async () => {
  const request = { sessionId: SESSION, identityId: OWNER, limit: 1, offset: 1_000 };
  assert.equal((await readConversation(makeEndlessRecords(), request))?.next_offset, null);
});
