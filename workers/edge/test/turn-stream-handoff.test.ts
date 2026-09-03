/**
 * W1-5 (#1254): `TurnStreamHandoff` — what one `POST /v1/chat` becomes when a
 * client is connected (spec §三 "alarm → SSE 交接契约"): admission, the arm
 * that starts the turn, and then the session's own live view handed straight
 * back as the response body.
 *
 * The invariant every case below is about is that an ACCEPTED run is never
 * lost. Admission refusals belong to the intake and travel out untouched — a
 * busy session is not this module's answer to give. But once the intake has
 * committed a run and armed it, the turn is running whatever happens next, so
 * every way of failing to open the live view degrades to the same thing: the
 * run id in a plain JSON body, which is §二's disconnect semantics said early
 * (the client comes back to `GET /v1/conversations/{id}/messages`).
 *
 * test-type: unit (in-memory intake ports and a stub namespace, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SseTurnChannel, sseResponse } from "../src/agent/session/sse-turn-channel.ts";
import { SessionBusyError, type IntakeReceipt, type TurnSubmission } from "../src/agent/intake/turn-intake.ts";
import {
  durableSessionStreams,
  handOffTurn,
  type TurnStreamHandoff,
} from "../src/agent/session/turn-stream-handoff.ts";

const SESSION = "anon_0123456789abcdef0123456789abcdef";
const RUN_ID = "0199ab00-1111-7000-8000-000000000001";
const NEW_RUN: IntakeReceipt = { messageId: "m-1", runId: RUN_ID, replayed: false };
const REPLAYED: IntakeReceipt = { messageId: "m-1", runId: RUN_ID, replayed: true };

function makeSubmission(): TurnSubmission {
  return {
    sessionId: SESSION,
    identityId: SESSION,
    payer: "anon",
    clientMessageId: "cmid-1",
    text: "秩父の聖地を回りたい",
  };
}

/** A session Durable Object that answers `answer` and records every request. */
function makeSessions(answer: () => Promise<Response>) {
  const requests: Request[] = [];
  const names: string[] = [];
  return {
    requests,
    names,
    stubs: {
      idFromName: (name: string) => {
        names.push(name);
        return { toString: () => name } as unknown as DurableObjectId;
      },
      get: () => ({
        fetch: (request: Request) => {
          requests.push(request);
          return answer();
        },
      }),
    },
  };
}

/**
 * A real DO stream response: one frame and the terminator, written as the
 * reader drains them. The writes are NOT awaited here — a `TransformStream`
 * applies backpressure at the first unread frame, which is exactly the
 * property `sse-turn-channel.ts` relies on, so a producer that waited for its
 * own reader would wait forever.
 */
function makeStreamedResponse(): Promise<Response> {
  const channel = new SseTurnChannel();
  const response = sseResponse(channel.body);
  void channel.send({ type: "start" }).then(() => channel.finish());
  return Promise.resolve(response);
}

interface RecordedHandoff {
  readonly handoff: TurnStreamHandoff;
  readonly armed: string[][];
  readonly requests: Request[];
}

function makeHandoff(receipt: IntakeReceipt, answer: () => Promise<Response>): RecordedHandoff {
  const armed: string[][] = [];
  const sessions = makeSessions(answer);
  return {
    armed,
    requests: sessions.requests,
    handoff: {
      intake: {
        backstop: { ensureScheduled: () => Promise.resolve() },
        records: { openTurn: () => Promise.resolve(receipt) },
        wakeup: {
          arm: (sessionId, runId) => {
            armed.push([sessionId, runId]);
            return Promise.resolve();
          },
        },
      },
      streams: durableSessionStreams(sessions.stubs),
    },
  };
}

void test("an accepted turn is answered with the session's own live stream", async () => {
  const recorded = makeHandoff(NEW_RUN, makeStreamedResponse);
  const response = await handOffTurn(recorded.handoff, makeSubmission());
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(await response.text(), 'data: {"type":"start"}\n\ndata: [DONE]\n\n');
});

void test("the live view is opened on the run the intake just armed", async () => {
  const recorded = makeHandoff(NEW_RUN, makeStreamedResponse);
  await (await handOffTurn(recorded.handoff, makeSubmission())).text();
  const opened = new URL(recorded.requests[0]?.url ?? "https://nowhere/");
  assert.deepEqual(recorded.armed, [[SESSION, RUN_ID]]);
  assert.equal(opened.pathname, "/stream");
  assert.equal(opened.searchParams.get("runId"), RUN_ID);
});

void test("a busy session is the intake's refusal and travels out untouched", async () => {
  const recorded = makeHandoff(NEW_RUN, makeStreamedResponse);
  const handoff: TurnStreamHandoff = {
    ...recorded.handoff,
    intake: {
      ...recorded.handoff.intake,
      records: { openTurn: () => Promise.reject(new SessionBusyError("running_turn")) },
    },
  };
  await assert.rejects(handOffTurn(handoff, makeSubmission()), SessionBusyError);
  assert.deepEqual(recorded.requests, []);
});

void test("a stream the session cannot open still hands back the accepted run", async () => {
  const recorded = makeHandoff(NEW_RUN, () => Promise.reject(new Error("stub unreachable")));
  const response = await handOffTurn(recorded.handoff, makeSubmission());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { session_id: SESSION, run_id: RUN_ID, streaming: false });
  assert.deepEqual(recorded.armed, [[SESSION, RUN_ID]]);
});

void test("a session that refuses the stream request hands back the accepted run too", async () => {
  const refused = () => Promise.resolve(new Response("Not found", { status: 404 }));
  const recorded = makeHandoff(NEW_RUN, refused);
  const response = await handOffTurn(recorded.handoff, makeSubmission());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { session_id: SESSION, run_id: RUN_ID, streaming: false });
});

void test("a replayed submission is answered by run id, never by a second stream", async () => {
  const recorded = makeHandoff(REPLAYED, makeStreamedResponse);
  const response = await handOffTurn(recorded.handoff, makeSubmission());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { session_id: SESSION, run_id: RUN_ID, streaming: false });
  assert.deepEqual(recorded.requests, []);
});

void test("the accepted-run body is JSON the client can read without a stream reader", async () => {
  const recorded = makeHandoff(REPLAYED, makeStreamedResponse);
  const response = await handOffTurn(recorded.handoff, makeSubmission());
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
