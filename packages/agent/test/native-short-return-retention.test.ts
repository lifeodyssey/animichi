import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow, type AgentMessage } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { PilgrimageToolContext } from "@animichi/agent/tools";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const compaction = { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 };

function statusText(messages: readonly AgentMessage[]) {
  return messages.flatMap((message) => message.role === "user" && typeof message.content === "string"
    && message.content.startsWith("<agent_status>\n") ? [message.content] : []).join("\n");
}

async function composed(options: { session: Session; toolContext: PilgrimageToolContext }, responses: FauxResponseStep[], captured: string[]) {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ ...options, models, model: provider.getModel(), compaction }, context);
  harness.hooks.on("transform_context", ({ messages }) => { captured.push(statusText(messages)); return undefined; });
  return harness;
}

async function toolResults(session: Session) {
  const entries = await session.findEntries({ type: "message" }, context);
  return entries.flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : []);
}

function assertShort(result: { details?: unknown } | undefined) {
  assert.ok(result?.details && typeof result.details === "object");
  assert.equal(Reflect.get(result.details, "frozenSummary"), undefined);
}

void test("short resolve returns keep every earlier title in the status context after a native compaction", async () => {
  const titles: [string, string, string] = ["First short title", "Second short title", "Third short title"];
  let resolutions = 0;
  const { repo, session, toolContext } = await fixture(() => {
    const title = resolutions === 0 ? titles[0] : resolutions === 1 ? titles[1] : titles[2];
    resolutions += 1;
    return Promise.resolve(Response.json({ outcome: "resolved", match: { bangumi_id: String(resolutions), title } }));
  });
  const captured: string[] = [];
  const harness = await composed({ session, toolContext }, [
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: titles[0] }), { stopReason: "toolUse" }), fauxAssistantMessage("One."),
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: titles[1] }), { stopReason: "toolUse" }), fauxAssistantMessage("Two."),
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: titles[2] }), { stopReason: "toolUse" }), fauxAssistantMessage("Three."),
    fauxAssistantMessage("A compact summary."), fauxAssistantMessage("A refined compact summary."), fauxAssistantMessage("After."),
  ], captured);
  try {
    const lane = await harness.lane("main", context);
    for (const title of titles) getOrThrow(await lane.prompt(title, undefined, context));
    const results = await toolResults(session);
    assert.equal(results.length, 3);
    for (const result of results) assertShort(result);
    getOrThrow(await lane.compact({}, context));
    getOrThrow(await lane.prompt("Follow up", undefined, context));
    const latest = captured.at(-1) ?? "";
    assert.match(latest, /First short title/);
    assert.match(latest, /Second short title/);
  } finally { await harness.close(context); await repo.close(context); }
});

void test("short nearby returns keep the lookup location in the status context after a native compaction", async () => {
  const candidates = [
    { id: "a", label: "alpha", name: "alpha", lat: 35, lng: 139, kind: "city", source: "seed" },
    { id: "b", label: "beta", name: "beta", lat: 36, lng: 140, kind: "city", source: "seed" },
  ];
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ candidates })));
  const captured: string[] = [];
  const harness = await composed({ session, toolContext }, [
    fauxAssistantMessage(fauxToolCall("search_nearby", { location: "The real location" }), { stopReason: "toolUse" }), fauxAssistantMessage("Which place?"),
    fauxAssistantMessage("A compact summary."), fauxAssistantMessage("A refined compact summary."), fauxAssistantMessage("After."),
  ], captured);
  try {
    const lane = await harness.lane("main", context);
    getOrThrow(await lane.prompt("Find a place", undefined, context));
    const [result] = await toolResults(session);
    assertShort(result);
    getOrThrow(await lane.compact({}, context));
    getOrThrow(await lane.prompt("Follow up", undefined, context));
    assert.match(captured.at(-1) ?? "", /Verbatim entity retained from an earlier search_nearby call: 「The real location」/);
  } finally { await harness.close(context); await repo.close(context); }
});

void test("a successful return without an entity argument retains nothing", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({})));
  const captured: string[] = [];
  const harness = await composed({ session, toolContext }, [
    fauxAssistantMessage(fauxToolCall("respond", { kind: "qa", message: "Just an answer." }), { stopReason: "toolUse" }),
  ], captured);
  try {
    const lane = await harness.lane("main", context);
    getOrThrow(await lane.prompt("Hello", undefined, context));
    const [result] = await toolResults(session);
    assert.ok(result?.details && typeof result.details === "object");
    assert.equal(Reflect.get(result.details, "executedFacts"), undefined);
    assert.doesNotMatch(captured.at(-1) ?? "", /Verbatim entity retained/);
  } finally { await harness.close(context); await repo.close(context); }
});

void test("a failed lookup retains nothing", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("Catalog failure")));
  const captured: string[] = [];
  const harness = await composed({ session, toolContext }, [
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Lost title" }), { stopReason: "toolUse" }), fauxAssistantMessage("Unavailable."),
  ], captured);
  try {
    const lane = await harness.lane("main", context);
    getOrThrow(await lane.prompt("Find it", undefined, context));
    const [result] = await toolResults(session);
    assert.equal(result?.isError, true);
    assert.ok(result.details && typeof result.details === "object");
    assert.equal(Reflect.get(result.details, "executedFacts"), undefined);
    assert.doesNotMatch(captured.at(-1) ?? "", /Lost title/);
  } finally { await harness.close(context); await repo.close(context); }
});
