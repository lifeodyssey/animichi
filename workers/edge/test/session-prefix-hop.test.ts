/**
 * E-1 (#1380): what the seeding hop answers when the request that reached the
 * Durable Object cannot be read at all.
 *
 * Every case here is a refusal decided BEFORE the database is opened, which is
 * why this file needs no Neon: the identity headers, and the body as JSON. The
 * refusals a seeding can take once it is reading real rows — an unowned
 * session, a session that has already taken a turn — are
 * `trajectory-prefix-seed.test.ts`.
 *
 * The class this file exists for is the one that has no `refusalFor` entry:
 * `request.json()` throws a `SyntaxError` on a malformed document, and an
 * unmapped throw out of `AgentSession.fetch` is answered by `app.onError` as a
 * 500 — a gateway fault reported for a body the caller wrote.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableEnvelopeStore } from "../src/agent/session/durable-envelope-store.ts";
import {
  answerPrefixSeeding,
  prefixSeedRequest,
  type SessionPrefixParts,
} from "../src/agent/session/session-prefix.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

/** The Durable Object's own side of the hop, with no data plane behind it —
 * nothing below reaches one, and a case that did would fail loudly. */
function makeHopParts(storage: RecordingEnvelopeStorage): SessionPrefixParts {
  return { env: {}, envelopes: new DurableEnvelopeStore(storage), owner: "do-incarnation-1" };
}

interface Refusal {
  readonly status: number;
  readonly code: unknown;
  readonly wrote: number;
}

async function refusalOf(body: string): Promise<Refusal> {
  const storage = new RecordingEnvelopeStorage();
  const response = await answerPrefixSeeding(
    makeHopParts(storage), prefixSeedRequest("session-42", "qa-neon-user", body),
  );
  const read = await response.json() as { error?: { code?: unknown } };
  return { status: response.status, code: read.error?.code, wrote: storage.writes.length };
}

void test("a body that is not JSON is the caller's 400, never a thrown gateway fault", async () => {
  const refusal = await refusalOf('{"case_id": ');

  assert.equal(refusal.status, 400);
  assert.equal(refusal.code, "invalid_prefix");
  assert.equal(refusal.wrote, 0);
});

void test("an empty body is refused on the same terms", async () => {
  const refusal = await refusalOf("");

  assert.equal(refusal.status, 400);
  assert.equal(refusal.code, "invalid_prefix");
});

void test("a body that is JSON but no prefix takes the same status under its own message", async () => {
  const storage = new RecordingEnvelopeStorage();

  const response = await answerPrefixSeeding(
    makeHopParts(storage), prefixSeedRequest("session-42", "qa-neon-user", "{}"),
  );
  const read = await response.json() as { error?: { message?: unknown } };

  assert.equal(response.status, 400);
  assert.equal(read.error?.message, "The prefix could not be read.");
});

void test("a hop without its identity header is a 400 rather than an unknown route", async () => {
  const storage = new RecordingEnvelopeStorage();
  const request = new Request("https://agent-session/seed-prefix", { method: "POST", body: "{}" });

  const response = await answerPrefixSeeding(makeHopParts(storage), request);

  assert.equal(response.status, 400);
  assert.deepEqual(storage.writes, []);
});
