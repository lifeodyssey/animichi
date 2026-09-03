/// <reference types="@cloudflare/workers-types" />

/**
 * `TurnStreamHandoff` — one `POST /v1/chat` composed end to end (W1-5 #1254,
 * spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三 "alarm → SSE 交接
 * 契约"): admit the turn, arm the session that will run it, and hand the
 * caller the live view the Durable Object opens for that run.
 *
 * This module owns the CALLER's half of the `GET /stream?runId=` hop, the way
 * `session-wakeup.ts` owns the caller's half of `POST /arm`; the other half is
 * `AgentSession.fetch` (#1252). It lives beside them for that reason.
 *
 * TWO REFUSALS THAT ARE NOT THIS MODULE'S: a busy session and an exhausted
 * quota are ADMISSION, decided before any run exists, and they travel out of
 * `acceptTurn` untouched for the route (#1256) to answer 409/402 with. Once a
 * run is committed and armed, the opposite rule applies — the turn is running
 * whatever happens to this response, so no failure past that point may drop it
 * on the floor. Every such failure degrades to the accepted-run body below,
 * which is §二's disconnect semantics said early: the client comes back to
 * `GET /v1/conversations/{id}/messages` and reads the result once.
 *
 * A REPLAY IS ANSWERED THE SAME WAY, deliberately. A replayed
 * `client_message_id` committed nothing and armed nothing; the run it resolved
 * to is already running or already settled, and this module cannot tell which
 * without a database read. Subscribing to a settled run would register a
 * subscriber nobody will ever close — a stream that hangs instead of ending —
 * so the replay takes the retrieval path the spec gives it.
 */
import type { NamedStubs } from "../durable-namespace.ts";
import { acceptTurn, type IntakeReceipt, type TurnIntake, type TurnSubmission } from "../intake/turn-intake.ts";
import { SESSION_STREAM_PATH } from "./agent-session.ts";

/** The one thing a connected client asks of a session: watch one run. */
export interface SessionStreams {
  open(sessionId: string, runId: string): Promise<Response>;
}

/** The stream request `AgentSession.fetch` answers with an SSE body. */
export function streamRequest(runId: string): Request {
  return new Request(`https://agent-session${SESSION_STREAM_PATH}?runId=${encodeURIComponent(runId)}`);
}

/** The production live view: one stub fetch against the session's own instance. */
export function durableSessionStreams(sessions: NamedStubs): SessionStreams {
  return {
    async open(sessionId, runId) {
      return await sessions.get(sessions.idFromName(sessionId)).fetch(streamRequest(runId));
    },
  };
}

/** The two collaborators one handoff drives: admission, then the live view. */
export interface TurnStreamHandoff {
  readonly intake: TurnIntake;
  readonly streams: SessionStreams;
}

/**
 * The run is accepted and running; this response only says the live view is
 * not part of it. `202 Accepted` is the literal truth — the work was taken and
 * the result is not in this response — and the run id is what the client
 * carries to the retrieval surface.
 */
function acceptedRunResponse(sessionId: string, receipt: IntakeReceipt): Response {
  return new Response(
    JSON.stringify({ session_id: sessionId, run_id: receipt.runId, streaming: false }),
    { status: 202, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

/** The session's live view, or nothing at all when it could not be opened.
 * A refusal and a transport failure are the same answer here: an accepted run
 * outranks its own live view. */
async function openedStream(
  handoff: TurnStreamHandoff,
  submission: TurnSubmission,
  receipt: IntakeReceipt,
): Promise<Response | null> {
  try {
    const response = await handoff.streams.open(submission.sessionId, receipt.runId);
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/**
 * Admit one turn and answer with its live view. Admission refusals reject;
 * everything after admission answers with a run the client can still collect.
 */
export async function handOffTurn(
  handoff: TurnStreamHandoff,
  submission: TurnSubmission,
  now: () => number = Date.now,
): Promise<Response> {
  const receipt = await acceptTurn(handoff.intake, submission, now);
  if (receipt.replayed) return acceptedRunResponse(submission.sessionId, receipt);
  const streamed = await openedStream(handoff, submission, receipt);
  return streamed ?? acceptedRunResponse(submission.sessionId, receipt);
}
