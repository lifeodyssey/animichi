/**
 * W1-7 (#1256): reading the AI SDK chat envelope the web already sends, so the
 * TS tier takes the same turn out of it that
 * `apps/agent/src/animichi/interfaces/routes/chat_body.py` takes today.
 *
 * test-type: unit (pure reader, no bindings, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ChatEnvelopeError,
  chatTurnText,
  requestLocale,
} from "../src/gateway/chat-envelope.ts";

const LIMIT = 4_000;

function userMessage(...texts: string[]): Record<string, unknown> {
  return { role: "user", parts: texts.map((text) => ({ type: "text", text })) };
}

void test("the newest user message is the turn; earlier ones are history", () => {
  const payload = {
    messages: [userMessage("古い質問"), { role: "assistant", parts: [] }, userMessage("秩父へ行きたい")],
  };
  assert.equal(chatTurnText(payload, "ja", LIMIT), "秩父へ行きたい");
});

void test("a message's text parts are concatenated in order", () => {
  assert.equal(chatTurnText({ messages: [userMessage("秩父", "の聖地")] }, "ja", LIMIT), "秩父の聖地");
});

void test("a non-text part refuses the whole turn in the caller's locale", () => {
  const payload = { messages: [{ role: "user", parts: [{ type: "file", url: "x" }] }] };
  assert.throws(
    () => chatTurnText(payload, "zh", LIMIT),
    (error: unknown) => error instanceof ChatEnvelopeError
      && error.refusal === "non_text_message"
      && error.detail === "请输入文字消息。",
  );
});

void test("a message longer than the ceiling is refused", () => {
  const payload = { messages: [userMessage("あ".repeat(11))] };
  assert.throws(
    () => chatTurnText(payload, "en", 10),
    (error: unknown) => error instanceof ChatEnvelopeError && error.refusal === "message_too_long",
  );
});

void test("an envelope with no user message is refused rather than committed empty", () => {
  assert.throws(
    () => chatTurnText({ messages: [{ role: "assistant", parts: [] }] }, "ja", LIMIT),
    (error: unknown) => error instanceof ChatEnvelopeError && error.refusal === "empty_message",
  );
});

void test("an empty-text user message is refused too — a blank transcript row is not a turn", () => {
  assert.throws(
    () => chatTurnText({ messages: [userMessage("")] }, "ja", LIMIT),
    (error: unknown) => error instanceof ChatEnvelopeError && error.refusal === "empty_message",
  );
});

void test("a body that is not an envelope at all is refused, never coerced", () => {
  assert.throws(
    () => chatTurnText("not json", "ja", LIMIT),
    (error: unknown) => error instanceof ChatEnvelopeError,
  );
});

void test("the locale header decides the words; anything unknown reads ja", () => {
  assert.equal(requestLocale("zh"), "zh");
  assert.equal(requestLocale("fr"), "ja");
  assert.equal(requestLocale(null), "ja");
});
