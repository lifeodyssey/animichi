/**
 * W1-5 (#1254) against real PostgreSQL: what a returning client reads back.
 *
 * Three of this retrieval's properties are claims about the DATABASE and not
 * about the use case, so a double cannot answer for any of them. "The latest
 * run" is an ordering over `runs` — a session that has already failed a turn
 * and then succeeded one must report the newer, whichever order the rows were
 * written in. `revision` is a count over the same table. And `created_at`
 * leaves the database as ISO-8601 text by the statement's own doing, because
 * the two drivers this adapter runs on disagree about what a `timestamptz`
 * comes back as.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readConversationOn } from "../src/agent/retrieval/neon-conversation-records.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { seedMessage, seedRun, seedSession } from "./agent-rows.ts";

const OWNER = "neon-subject-1";
const STRANGER = "neon-subject-2";

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

function read(sessionId: string, identityId: string = OWNER) {
  return readConversationOn(plane.transactions, { sessionId, identityId });
}

/** A session owned by OWNER, with the runs named, oldest first. */
async function seedOwnedSession(sessionId: string): Promise<void> {
  await seedSession(plane.database, sessionId, OWNER);
}

/** The instant the two tied rows share. `created_at` defaults to `now()`,
 * which is the TRANSACTION's clock, so any two messages one transaction
 * writes carry exactly this much of an ordering: none. */
const TIED_INSTANT = "2026-08-01T11:00:00Z";

/** UUIDv7 keys whose last digit is their write order; the row written FIRST
 * is given the LATER key, so the heap order a read without a tie-breaker
 * falls back on is the reverse of the one the keys state. */
const TIED_KEY_PREFIX = "01930000-0000-7000-8000-00000000000";

function seedTiedMessage(sessionId: string, row: { id: string; content: string }): Promise<void> {
  return seedMessage(plane.database, { sessionId, role: "user", createdAt: TIED_INSTANT, ...row });
}

void test("the latest run of a session that failed once and then succeeded is the success", async () => {
  const sessionId = "retrieval-latest-succeeded";
  await seedOwnedSession(sessionId);
  await seedRun(plane.database, {
    sessionId,
    status: "failed",
    failureReason: "provider_failed",
    leaseExpiresAt: null,
  });
  const succeeded = await seedRun(plane.database, {
    sessionId,
    status: "succeeded",
    leaseExpiresAt: null,
  });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.run, { run_id: succeeded, status: "succeeded", reason: null });
});

void test("the latest run of a session that succeeded once and then failed carries the reason", async () => {
  const sessionId = "retrieval-latest-failed";
  await seedOwnedSession(sessionId);
  await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  const failed = await seedRun(plane.database, {
    sessionId,
    status: "failed",
    failureReason: "deadline_exceeded",
    leaseExpiresAt: null,
  });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.run, { run_id: failed, status: "failed", reason: "deadline_exceeded" });
});

void test("a turn still running is reported as running", async () => {
  const sessionId = "retrieval-running";
  await seedOwnedSession(sessionId);
  const running = await seedRun(plane.database, { sessionId, status: "running", leaseExpiresAt: null });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.run, { run_id: running, status: "running", reason: null });
});

void test("revision counts the turns the session committed", async () => {
  const sessionId = "retrieval-revision";
  await seedOwnedSession(sessionId);
  await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  const page = await read(sessionId);
  assert.ok(page);
  assert.equal(page.revision, 2);
});

void test("a session that never opened a turn reports no run at all", async () => {
  const sessionId = "retrieval-no-run";
  await seedOwnedSession(sessionId);
  await seedMessage(plane.database, {
    sessionId,
    role: "user",
    content: "秩父の聖地を回りたい",
    createdAt: "2026-08-01T10:00:00Z",
  });
  const page = await read(sessionId);
  assert.ok(page);
  assert.equal(page.run, null);
  assert.equal(page.revision, 0);
});

void test("the transcript comes back oldest first, with its envelope and an ISO instant", async () => {
  const sessionId = "retrieval-transcript";
  await seedOwnedSession(sessionId);
  await seedMessage(plane.database, {
    sessionId,
    role: "assistant",
    content: "ルートを作成しました。",
    createdAt: "2026-08-01T12:00:00Z",
    responseData: { intent: "search_bangumi", success: true },
  });
  await seedMessage(plane.database, {
    sessionId,
    role: "user",
    content: "first",
    createdAt: "2026-08-01T10:00:00Z",
  });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.messages.map((message) => message.content), ["first", "ルートを作成しました。"]);
  assert.deepEqual(page.messages.map((message) => message.response_data), [
    null,
    { intent: "search_bangumi", success: true },
  ]);
  assert.deepEqual(page.messages.map((message) => message.created_at), [
    "2026-08-01T10:00:00+00:00",
    "2026-08-01T12:00:00+00:00",
  ]);
});

void test("two messages stamped in the same instant come back in key order", async () => {
  const sessionId = "retrieval-created-at-tie";
  await seedOwnedSession(sessionId);
  await seedTiedMessage(sessionId, { id: `${TIED_KEY_PREFIX}2`, content: "second" });
  await seedTiedMessage(sessionId, { id: `${TIED_KEY_PREFIX}1`, content: "first" });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.messages.map((message) => message.content), ["first", "second"]);
});

void test("a session that belongs to someone else is not readable", async () => {
  const sessionId = "retrieval-forbidden";
  await seedOwnedSession(sessionId);
  await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  assert.equal(await read(sessionId, STRANGER), null);
});

void test("a session that does not exist reads the same as one that is forbidden", async () => {
  assert.equal(await read("retrieval-absent"), null);
});
