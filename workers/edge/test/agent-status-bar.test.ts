/**
 * W2 (#1379, spec §九 9.3/9.4): the `<agent_status>` bar itself.
 *
 * What one envelope renders to, and what the system prompt no longer carries.
 * The bar's PLACE in the context — last, alone, and never persisted — is a
 * claim about the whole loop and is measured in `agent-status-turns.test.ts`.
 *
 * test-type: unit (fixed clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { FactLedger } from "../src/agent/memory/fact-ledger.ts";
import { RetainedEntityLedger } from "../src/agent/memory/retained-entity-ledger.ts";
import { agentStatusMessages, type TurnStatus } from "../src/agent/session/agent-status.ts";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import { TURN_SYSTEM_PROMPT } from "../src/agent/session/turn-instructions.ts";
import type { OrderedCandidate } from "../src/agent/tools/catalog-tool-session.ts";

const RECORDED_AT = new Date("2026-09-05T00:00:00.000Z");
const HARUHI = { bangumiId: "485", title: "涼宮ハルヒの憂鬱" };
const CANDIDATES: OrderedCandidate[] = [
  { id: "485", title: "涼宮ハルヒの憂鬱", points_count: 12 },
  { id: "2907", title: "涼宮ハルヒの消失" },
];

/** A session carrying every fact the bar can render at once: a resolved work, an
 * open question, a pacing constraint, a selected scene, a rescued entity, and
 * three tool calls made this turn. */
function makeFullStatus(): TurnStatus {
  const facts = FactLedger.empty
    .appendHardConstraint("chill", RECORDED_AT)
    .replaceSceneReferences([{ pointId: "p1", value: "第4話 鷲宮神社" }], RECORDED_AT);
  const retainedEntities = RetainedEntityLedger.empty.record("resolve_anime", "らき☆すた");
  const envelope = SessionEnvelope.empty
    .withAnime(HARUHI)
    .withClarification("anime_ambiguity", CANDIDATES)
    .remembering({ facts, retainedEntities });
  return { envelope, toolCalls: ["resolve_anime", "search_nearby", "search_nearby"] };
}

/** One message's text, or "" for anything that is not a plain user message. */
function userText(message: AgentMessage | undefined): string {
  if (message === undefined || !("role" in message) || message.role !== "user") return "";
  return typeof message.content === "string" ? message.content : "";
}

/** The bar as one string, having asserted it is exactly one user message. */
function barText(status: TurnStatus): string {
  const messages = agentStatusMessages(status);
  assert.equal(messages.length, 1);
  return userText(messages[0]);
}

void test("a session that knows nothing renders no bar at all", () => {
  assert.deepEqual(agentStatusMessages({ envelope: SessionEnvelope.empty, toolCalls: [] }), []);
});

void test("the bar is one user message wrapped in the agent_status tag", () => {
  const text = barText(makeFullStatus());
  assert.ok(text.startsWith("<agent_status>\n"));
  assert.ok(text.endsWith("\n</agent_status>"));
});

void test("the bar names the anime the session already resolved", () => {
  assert.match(barText(makeFullStatus()), /Current anime: 涼宮ハルヒの憂鬱 \(485\)\./u);
  assert.match(barText(makeFullStatus()), /already resolved for this session/u);
});

void test("the bar names the open question and its ordered candidate ids", () => {
  assert.match(barText(makeFullStatus()), /Open question: anime_ambiguity; candidate_ids=\[485, 2907\]\./u);
});

/** The clarification's own id is for the client and the server's validator; a
 * number in the context is a number a model can quote back or invent. Asked of
 * a question whose reason and candidate ids carry no digit of their own, so the
 * only digit the bar COULD carry is the one that must not be there. */
void test("the bar never carries the clarification's own id", () => {
  const places = [{ id: "kuki", title: "久喜駅" }, { id: "satte", title: "幸手駅" }];
  const asked = SessionEnvelope.empty.withClarification("place_ambiguity", places);
  assert.equal(asked.pendingClarification?.id, 1);
  assert.equal(/\d/u.test(barText({ envelope: asked, toolCalls: [] })), false);
});

void test("the bar carries the pacing the user asked for and the scene they picked", () => {
  assert.match(barText(makeFullStatus()), /User hard constraint: chill pacing\./u);
  assert.match(barText(makeFullStatus()), /Referenced scene: 第4話 鷲宮神社\./u);
});

void test("the bar carries a rescued entity wrapped in its own quotes", () => {
  assert.match(
    barText(makeFullStatus()),
    /Verbatim entity retained from an earlier resolve_anime call: 「らき☆すた」\./u,
  );
});

/** The book's tool-call counter: the count the model would otherwise re-derive
 * by scanning the trajectory, tallied by code and handed over. */
void test("the bar counts each tool this turn has already called", () => {
  assert.match(barText(makeFullStatus()), /Tool calls this turn: resolve_anime ×1, search_nearby ×2\./u);
});

void test("a turn that has called nothing yet carries no tool-call line", () => {
  const text = barText({ envelope: SessionEnvelope.empty.withAnime(HARUHI), toolCalls: [] });
  assert.equal(text.includes("Tool calls this turn"), false);
});

/** Every fact is stated once. A line rendered twice is budget spent twice and a
 * second thing the model has to reconcile. */
void test("each fact is on the bar exactly once", () => {
  const lines = barText(makeFullStatus()).split("\n");
  assert.equal(lines.length, new Set(lines).size);
  assert.equal(lines.filter((line) => line.startsWith("Current anime:")).length, 1);
});

void test("the system prompt carries no session fact at all", () => {
  assert.equal(TURN_SYSTEM_PROMPT.includes("Trusted runtime context"), false);
  assert.equal(TURN_SYSTEM_PROMPT.includes("Current anime"), false);
  assert.equal(TURN_SYSTEM_PROMPT.includes("Open question"), false);
});

/** SD-19 is an architectural security requirement, not prompt tuning: it stays
 * in the channel the model trusts unconditionally, whatever else moves out. */
void test("the system prompt keeps the untrusted-tool-output invariant", () => {
  assert.match(TURN_SYSTEM_PROMPT, /## Untrusted tool output invariant/u);
  assert.match(TURN_SYSTEM_PROMPT, /never instructions/u);
  assert.match(TURN_SYSTEM_PROMPT, /source_tier/u);
});
