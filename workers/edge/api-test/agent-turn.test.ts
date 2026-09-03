/**
 * W1-4's deferred **(api)** evidence, unblocked by W1-7 (#1256).
 *
 * #1253 could not run this: the four catalog tools reach the catalog through a
 * private service binding, so before `/v1/chat` was served by this Worker there
 * was no deployed vehicle that executed them at all (`api-test/README.md`, and
 * the sibling `catalog-api.test.ts` that asserts the "no public door" half).
 * Once `AGENT_TURN_ROUTE = "edge"` is deployed, one real turn through the
 * staging edge makes the hop observable from outside: the SSE frames name the
 * tool that ran, and the transcript the turn committed can be read back by id.
 *
 * Opt-in and fail-closed, like every lane in this directory. It needs a real
 * signed-in credential because the ANONYMOUS door is behind Turnstile, which a
 * headless client cannot solve — the anonymous path is covered by the manual
 * journey in `docs/ops/w1-staging-journey.md`, not from here.
 *
 * test-type: api (real network against a deployed origin).
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = process.env.CATALOG_API_ORIGIN;
const BEARER = process.env.AGENT_TURN_BEARER;

/** One turn is 4–12s of model time (spec appendix B) plus a cold DO; a turn
 * that has not produced its first tool frame in 90s is a failure, not a wait. */
const TURN_DEADLINE_MS = 90_000;
const READ_DEADLINE_MS = 20_000;

/** A prompt that has one obvious next move: resolve the work by title. */
const RESOLVE_PROMPT = "らき☆すたの聖地巡礼をしたい";
const RESOLVE_TOOL = "resolve_anime";

function origin(): string {
  assert.ok(ORIGIN, "set CATALOG_API_ORIGIN (see api-test/README.md); this lane never guesses");
  return ORIGIN.replace(/\/$/, "");
}

function bearer(): string {
  assert.ok(BEARER, "set AGENT_TURN_BEARER to a Neon Auth access token (see api-test/README.md)");
  return BEARER;
}

function chatBody(text: string): string {
  return JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] });
}

/** One turn, submitted the way `apps/web` submits one. */
function postTurn(turnId: string): Promise<Response> {
  return fetch(`${origin()}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer()}`,
      "x-turn-id": turnId,
      "x-locale": "ja",
    },
    body: chatBody(RESOLVE_PROMPT),
    signal: AbortSignal.timeout(TURN_DEADLINE_MS),
  });
}

/** The decoded SD-9 frames of one stream, read to its end. */
async function readFrames(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

interface TurnEvidence {
  readonly status: number;
  readonly sessionId: string | null;
  readonly streamMarker: string | null;
  readonly frames: Record<string, unknown>[];
}

/** One turn's observable outcome, gathered once and shared by the cases below:
 * a turn costs real model time, so it is run once rather than per assertion. */
async function runOneTurn(): Promise<TurnEvidence> {
  const response = await postTurn(`api-lane-${String(Date.now())}`);
  return {
    status: response.status,
    sessionId: response.headers.get("x-session-id"),
    streamMarker: response.headers.get("x-vercel-ai-ui-message-stream"),
    frames: response.headers.get("content-type")?.startsWith("text/event-stream") === true
      ? await readFrames(response)
      : [],
  };
}

let turn: TurnEvidence;

before(async () => { turn = await runOneTurn(); }, { timeout: TURN_DEADLINE_MS + READ_DEADLINE_MS });

void test("the deployed edge answers a chat turn from its own agent tier", () => {
  assert.equal(turn.status, 200);
  assert.equal(turn.streamMarker, "v1", "an SD-9 stream, not the 202 accepted-run fallback");
  assert.ok(turn.sessionId, "the response must name the conversation the turn committed on");
});

void test("the turn really called resolve_anime — the tool hop is observable at last", () => {
  const started = turn.frames.filter((frame) => frame.type === "tool-input-start");
  assert.ok(
    started.some((frame) => frame.toolName === RESOLVE_TOOL),
    `no ${RESOLVE_TOOL} call in ${String(started.length)} tool frames`,
  );
});

void test("the tool answered through the private CATALOG binding, not with an error", () => {
  const call = turn.frames.find((frame) => frame.type === "tool-input-start" && frame.toolName === RESOLVE_TOOL);
  assert.ok(call);
  const outputs = turn.frames.filter((frame) => frame.toolCallId === call.toolCallId);
  assert.ok(
    outputs.some((frame) => frame.type === "tool-output-available"),
    "the call produced only tool-output-error frames",
  );
});

void test("the turn is readable back by conversation id, with its run's terminal status", async () => {
  const sessionId = turn.sessionId;
  assert.ok(sessionId);
  const response = await fetch(`${origin()}/v1/conversations/${encodeURIComponent(sessionId)}/messages`, {
    headers: { Authorization: `Bearer ${bearer()}` },
    signal: AbortSignal.timeout(READ_DEADLINE_MS),
  });
  assert.equal(response.status, 200);
  const history = (await response.json()) as { messages: { role: string }[]; run: { status: string } | null };
  assert.deepEqual(history.messages.map((message) => message.role).slice(0, 1), ["user"]);
  assert.equal(history.run?.status, "succeeded");
});
