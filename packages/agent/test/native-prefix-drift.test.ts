import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { getOrThrow, MemorySessionRepo, type Session } from "@earendil-works/pi-agent-core";
import {
  createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep, type Message, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createCatalogClient, type PilgrimageToolContext } from "@animichi/agent/tools";
import { NATIVE_AGENT_OPTIONS } from "@animichi/agent";
import {
  assertPrefixPinned, assertPrefixStable, createPilgrimageHarness, requestPrefixOf, serializePrefix,
} from "@animichi/agent/harness";

const AMBIGUOUS = { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [
  { bangumi_id: "485", title: "First title with a long catalog description ".repeat(2) },
  { bangumi_id: "2907", title: "Second title with a long catalog description ".repeat(2) },
] };

function toolsFor(session: Session, locale: string): PilgrimageToolContext {
  return { session, branch: "main", locale, catalog: createCatalogClient(() => Promise.resolve(Response.json(AMBIGUOUS))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() };
}

async function openSession(now: number, id: string, locale: string) {
  const repo = new MemorySessionRepo({ now: () => now });
  const session = await repo.create({ id }, BACKGROUND_CONTEXT);
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(), ...NATIVE_AGENT_OPTIONS,
    toolContext: toolsFor(session, locale), retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } }, BACKGROUND_CONTEXT);
  return { provider, harness, lane: await harness.lane("main", BACKGROUND_CONTEXT),
    close: async () => { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); } };
}

function capture(requests: Message[][], reply: () => ReturnType<typeof fauxAssistantMessage>): FauxResponseStep {
  return (context: TranscriptContext) => { requests.push(context.messages); return reply(); };
}

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
}

function summaryOf(message: Message): string | undefined {
  if (message.role !== "toolResult") return undefined;
  const details = message.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  const summary: unknown = Reflect.get(details, "frozenSummary");
  return typeof summary === "string" ? summary : undefined;
}

function isDeclaredFrozen(before: Message, after: Message): boolean {
  const summary = summaryOf(before);
  return after.role === "toolResult" && summary !== undefined && textOf(after) === summary;
}

function durable(messages: readonly Message[]): Message[] {
  return messages.filter((message) => !(message.role === "user" && textOf(message).startsWith("<agent_status>")));
}

function assertAppendOnly(early: readonly Message[], late: readonly Message[]): void {
  const base = durable(early);
  const next = durable(late);
  assert.ok(next.length >= base.length, "the later request dropped transcript messages");
  base.forEach((message, index) => {
    const other = next[index];
    assert.ok(other, `the later request lost message ${String(index)}`);
    if (isDeclaredFrozen(message, other)) return;
    assert.deepEqual(other, message);
  });
}

void test("two consecutive turns of one session send a byte-identical request prefix", async () => {
  const opened = await openSession(0, "turn-session", "en");
  const requests: Message[][] = [];
  opened.provider.setResponses([
    capture(requests, () => fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Sound Euphonium" }), { stopReason: "toolUse" })),
    capture(requests, () => fauxAssistantMessage(fauxToolCall("respond", { kind: "greeting", message: "Hello" }), { stopReason: "toolUse" })),
    capture(requests, () => fauxAssistantMessage(fauxToolCall("respond", { kind: "greeting", message: "Again" }), { stopReason: "toolUse" })),
  ]);
  try {
    getOrThrow(await opened.lane.prompt("Find Sound Euphonium", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await opened.lane.prompt("Hello again", undefined, BACKGROUND_CONTEXT));
  } finally { await opened.close(); }
  const [first, second, third] = requests;
  assert.ok(first && second && third);
  assert.equal(new Set(requests.map((messages) => serializePrefix(requestPrefixOf(messages)))).size, 1);
  assertPrefixStable(requestPrefixOf(first), requestPrefixOf(third));
  assertPrefixPinned(requestPrefixOf(first));
  assertAppendOnly(first, second);
  assertAppendOnly(second, third);
  const frozen = second.find((message) => message.role === "toolResult" && message.toolName === "resolve_anime");
  const substituted = third.find((message) => message.role === "toolResult" && message.toolName === "resolve_anime");
  assert.ok(frozen && substituted);
  assert.equal(textOf(substituted), summaryOf(frozen));
  assert.notEqual(textOf(substituted), textOf(frozen));
});

void test("two sessions under different clocks, locales and ids send a byte-identical prefix", async () => {
  const early = await openSession(0, "session-a", "en");
  const late = await openSession(1_700_000_000_000, "session-b", "ja");
  const requestsEarly: Message[][] = [];
  const requestsLate: Message[][] = [];
  early.provider.setResponses([capture(requestsEarly, () => fauxAssistantMessage("Hi", { stopReason: "stop" }))]);
  late.provider.setResponses([capture(requestsLate, () => fauxAssistantMessage("こんにちは", { stopReason: "stop" }))]);
  try {
    getOrThrow(await early.lane.prompt("Hello", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await late.lane.prompt("こんにちは", undefined, BACKGROUND_CONTEXT));
  } finally { await early.close(); await late.close(); }
  const [requestEarly] = requestsEarly;
  const [requestLate] = requestsLate;
  assert.ok(requestEarly && requestLate);
  assert.equal(serializePrefix(requestPrefixOf(requestEarly)), serializePrefix(requestPrefixOf(requestLate)));
  assert.doesNotThrow(() => { assertPrefixPinned(requestPrefixOf(requestEarly)); });
  assert.doesNotThrow(() => { assertPrefixPinned(requestPrefixOf(requestLate)); });
});
