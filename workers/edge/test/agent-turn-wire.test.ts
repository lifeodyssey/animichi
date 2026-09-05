/**
 * W1-7 (#1256): what a caller is told when the agent tier does NOT run a turn,
 * and what the submission it does run is built from.
 *
 * Every shape here already exists on the wire — the flag is a fallback flag, so
 * a client cannot tell which tier answered it. The cases therefore read against
 * the Python sites they replace (`routes/admission.py`, `routes/chat.py`,
 * `routes/conversations.py`) and against `packages/contract`'s error registry,
 * which is read verbatim rather than imported (zod stays out of this bundle).
 *
 * test-type: unit (pure builders, injected clock through the usage date).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { MESSAGE_MAX_CHARS, refusalFor, submissionOf } from "../src/gateway/agent-turn.ts";
import { SESSION_ID_HEADER, UI_MESSAGE_STREAM_HEADER, turnResponse } from "../src/gateway/agent-turn-responses.ts";
import { QuotaExhaustedError } from "../src/agent/intake/anonymous-message-allowance.ts";
import { SessionBusyError, SessionOwnershipError } from "../src/agent/intake/turn-intake.ts";
import { ChatEnvelopeError } from "../src/gateway/chat-envelope.ts";
import { handOffTurn } from "../src/agent/session/turn-stream-handoff.ts";

const ANON: { userId: string; userType: string } = {
  userId: "anon_0123456789abcdef0123456789abcdef",
  userType: "anonymous",
};
const BODY = JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "秩父へ" }] }] });

function chatRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://animichi.test/v1/chat", { method: "POST", body: BODY, headers });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

void test("the submission carries the named conversation, the dedupe key and the anonymous payer", async () => {
  const submission = await submissionOf(
    chatRequest({ "x-session-id": "s-7", "x-turn-id": "t-9" }), ANON, "ja",
  );
  assert.deepEqual(submission, {
    sessionId: "s-7",
    identityId: ANON.userId,
    payer: "anon",
    clientMessageId: "t-9",
    text: "秩父へ",
    // A request with no `X-BYOK-*` headers carries no credential (#1289) — the
    // turn runs on the deployment's own model, exactly as it did before.
    byok: undefined,
    selection: null,
  });
});

void test("a turn with no session id opens a fresh conversation instead of failing", async () => {
  const submission = await submissionOf(chatRequest(), ANON, "ja");
  assert.match(submission.sessionId, /^[0-9a-f-]{36}$/);
});

void test("a signed-in submission is billed to the member payer, never the anonymous counter", async () => {
  const submission = await submissionOf(chatRequest(), { userId: "u1", userType: "human" }, "ja");
  assert.equal(submission.payer, "user");
});

void test("an oversized session id is refused rather than written as a primary key", async () => {
  await assert.rejects(
    submissionOf(chatRequest({ "x-session-id": "s".repeat(201) }), ANON, "ja"),
    (error: unknown) => error instanceof ChatEnvelopeError && error.refusal === "invalid_body",
  );
});

// EG-09 (#1343): the dedupe key is read through the same bound as the session
// id. `""` is not nullish, so a present-but-empty `x-turn-id` used to become the
// literal empty `client_message_id` — and the partial unique index would then
// resolve every later empty-id turn in that session to the first message.
void test("a present but empty dedupe key opens a fresh turn, never a replay of the first", async () => {
  const submission = await submissionOf(chatRequest({ "x-turn-id": "   " }), ANON, "ja");
  assert.match(submission.clientMessageId, /^[0-9a-f-]{36}$/);
});

void test("an oversized dedupe key is refused rather than written as a column", async () => {
  await assert.rejects(
    submissionOf(chatRequest({ "x-turn-id": "t".repeat(201) }), ANON, "ja"),
    (error: unknown) => error instanceof ChatEnvelopeError && error.refusal === "invalid_body",
  );
});

void test("the message ceiling is the spec's finalized 4000 characters", () => {
  assert.equal(MESSAGE_MAX_CHARS, 4_000);
});

void test("a spent allowance is a 403 with the contract's code and reset instant", async () => {
  const refusal = refusalFor(new QuotaExhaustedError("2026-09-02"));
  assert.ok(refusal);
  assert.equal(refusal.status, 403);
  assert.deepEqual(await body(refusal), {
    error: {
      code: "anon_quota_exhausted",
      message: "今日はここまで・ログインすると続けられるよ。",
      action: "login",
      data: { quota_resets_at: "2026-09-03T00:00:00Z" },
    },
  });
});

void test("the quota code is the one packages/contract publishes, not a private spelling", () => {
  const registry = readFileSync(
    fileURLToPath(new URL("../../../packages/contract/src/error-registry.ts", import.meta.url)),
    "utf8",
  );
  assert.match(registry, /ANON_QUOTA_EXHAUSTED_CODE = "anon_quota_exhausted"/);
  assert.match(registry, /quota_resets_at:/);
});

void test("a session that already has a running turn is a 409, never a second run", async () => {
  const refusal = refusalFor(new SessionBusyError("running_turn"));
  assert.ok(refusal);
  assert.equal(refusal.status, 409);
  assert.deepEqual(await body(refusal), {
    error: { code: "turn_in_flight", message: "リクエストを処理中です。しばらくしてからお試しください。" },
  });
});

void test("a conversation belonging to someone else is answered as if it did not exist", async () => {
  const refusal = refusalFor(new SessionOwnershipError());
  assert.ok(refusal);
  assert.equal(refusal.status, 404);
  assert.deepEqual(await body(refusal), { detail: "Conversation not found." });
});

void test("an unreadable body is a 422 carrying the words the client renders", async () => {
  const refusal = refusalFor(new ChatEnvelopeError("non_text_message", "zh"));
  assert.ok(refusal);
  assert.equal(refusal.status, 422);
  assert.deepEqual(await body(refusal), { detail: "请输入文字消息。" });
});

void test("anything that is not a refusal is left to fail — this tier invents no 500", () => {
  assert.equal(refusalFor(new Error("neon unreachable")), null);
});

void test("a live turn is stamped with the SD-9 marker and the session it committed on", () => {
  const streamed = new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } });
  const stamped = turnResponse(streamed, "s-7");
  assert.equal(stamped.headers.get(UI_MESSAGE_STREAM_HEADER), "v1");
  assert.equal(stamped.headers.get(SESSION_ID_HEADER), "s-7");
});

void test("an accepted-but-unstreamed turn names its session without claiming to be a stream", () => {
  const accepted = new Response("{}", { status: 202, headers: { "content-type": "application/json" } });
  const stamped = turnResponse(accepted, "s-7");
  assert.equal(stamped.status, 202);
  assert.equal(stamped.headers.get(SESSION_ID_HEADER), "s-7");
  assert.equal(stamped.headers.get(UI_MESSAGE_STREAM_HEADER), null);
});

void test("a refused turn arms no session and opens no live view — nothing to collect later", async () => {
  const armed: string[] = [];
  const opened: string[] = [];
  const refused = handOffTurn({
    intake: {
      backstop: { ensureScheduled: () => Promise.resolve() },
      records: { openTurn: (turn) => Promise.reject(new QuotaExhaustedError(turn.reservation?.usageDate ?? "")) },
      wakeup: { arm: (sessionId) => { armed.push(sessionId); return Promise.resolve(); } },
    },
    streams: { open: (sessionId) => { opened.push(sessionId); return Promise.resolve(new Response(null)); } },
  }, {
    sessionId: "s-7",
    identityId: ANON.userId,
    payer: "anon",
    clientMessageId: "t-9",
    text: "秩父へ",
    selection: null,
  }, () => Date.parse("2026-09-02T23:30:00.000Z"));
  await assert.rejects(refused, (error: unknown) => error instanceof QuotaExhaustedError);
  assert.deepEqual([armed, opened], [[], []]);
});
