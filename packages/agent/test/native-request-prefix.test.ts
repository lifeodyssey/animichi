import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, normalizeContext, type Message } from "@earendil-works/pi-ai";
import { NATIVE_AGENT_OPTIONS, NATIVE_SYSTEM_PROMPT } from "@animichi/agent";
import { NATIVE_TOOL_ORDER, NATIVE_TOOLS } from "@animichi/agent/tools";
import {
  assertPrefixPinned, assertPrefixStable, createPilgrimageHarness, prefixDrift, requestPrefixOf, type RequestPrefix,
} from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const PINNED_ORDER = ["resolve_anime", "search_bangumi", "search_nearby", "plan_route",
  "translate_anime_title", "web_search", "respond"];

function namesOf(prefix: RequestPrefix): string[] {
  return prefix.tools.map((tool) => tool.name);
}

function prefixFor(systemPrompt: string): RequestPrefix {
  return requestPrefixOf(normalizeContext({ systemPrompt, messages: [], tools: [...NATIVE_TOOLS] }).messages);
}

void test("the pinned advertised tool order is the fixed seven-name list", () => {
  assert.deepEqual([...NATIVE_TOOL_ORDER], PINNED_ORDER);
});

void test("the prefix guard names the line a timestamp added to the system prompt", () => {
  const mutated = prefixFor(`${NATIVE_SYSTEM_PROMPT}\nCurrent date: 2026-10-02`);
  assert.throws(() => { assertPrefixStable(prefixFor(NATIVE_SYSTEM_PROMPT), mutated); },
    /system prompt changed at line 6: "<absent>" -> "Current date: 2026-10-02"/u);
});

void test("the prefix guard names a session id injected into the system prompt", () => {
  const mutated = prefixFor(`${NATIVE_SYSTEM_PROMPT}\nSession: 01JABCDEF`);
  assert.throws(() => { assertPrefixStable(prefixFor(NATIVE_SYSTEM_PROMPT), mutated); },
    /system prompt changed at line 6/u);
});

void test("the prefix guard names a request id injected into the system prompt", () => {
  const lines = NATIVE_SYSTEM_PROMPT.split("\n");
  const mutated = prefixFor([...lines.slice(0, 2), "Request: req-77", ...lines.slice(2)].join("\n"));
  assert.throws(() => { assertPrefixStable(prefixFor(NATIVE_SYSTEM_PROMPT), mutated); },
    /system prompt changed at line 3: "Use web_search[^"]*" -> "Request: req-77"/u);
});

void test("the prefix guard names a tool reorder rather than the whole block", () => {
  const before = prefixFor(NATIVE_SYSTEM_PROMPT);
  const [first, second, ...rest] = before.tools;
  assert.ok(first && second);
  const reordered: RequestPrefix = { prompt: before.prompt, tools: [second, first, ...rest] };
  const expected = `tool order changed: [${namesOf(before).join(", ")}]`
    + ` -> [${[second.name, first.name, ...rest.map((tool) => tool.name)].join(", ")}]`;
  assert.deepEqual(prefixDrift(before, reordered), [expected]);
  assert.throws(() => { assertPrefixStable(before, reordered); }, /tool order changed/u);
});

void test("the guard names a tool declaration that moved without reordering", () => {
  const before = prefixFor(NATIVE_SYSTEM_PROMPT);
  const [first, ...rest] = before.tools;
  assert.ok(first);
  const rewritten: RequestPrefix = { prompt: before.prompt,
    tools: [{ ...first, description: `${first.description} Extra.` }, ...rest] };
  assert.throws(() => { assertPrefixPinned(rewritten); }, /tool declaration changed: resolve_anime/u);
});

void test("the production harness advertises the pinned prompt and tool order in the sent request", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No catalog request expected")));
  const captured: Message[][] = [];
  const provider = fauxProvider();
  provider.setResponses([(context) => {
    captured.push(context.messages);
    return fauxAssistantMessage("Hello!", { stopReason: "stop" });
  }]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel(), ...NATIVE_AGENT_OPTIONS }, BACKGROUND_CONTEXT);
  try {
    await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Hello", undefined, BACKGROUND_CONTEXT);
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
  const request = captured[0];
  assert.ok(request);
  const prefix = requestPrefixOf(request);
  assert.equal(prefix.prompt, NATIVE_SYSTEM_PROMPT);
  assert.deepEqual(namesOf(prefix), PINNED_ORDER);
  assert.doesNotThrow(() => { assertPrefixPinned(prefix); });
});
