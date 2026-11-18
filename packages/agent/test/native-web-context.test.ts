/**
 * SUT: the context the pilgrimage harness hands the model. A `web_search` result in it, from the current
 * turn or an earlier one, carries the text rendered from its recorded details instead of the text stored
 * with it, also when the agent status cannot be built. Other tools' frozen summaries still apply, and no
 * stored entry changes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow, type AgentMessage } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { fixture, pilgrimageHarnessFor } from "./native-tool-fixture.ts";
import { resultPage } from "./web-result-page.ts";
import { wrapperText } from "./stored-web-message.ts";

type Harness = Awaited<ReturnType<typeof pilgrimageHarnessFor>>["harness"];

const SEARCH = fauxAssistantMessage(fauxToolCall("web_search", { query: "Lucky Star" }), { stopReason: "toolUse" });
const RESOLVE = fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Lucky Star" }), { stopReason: "toolUse" });
const PAGE = resultPage([{ title: "Lucky Star", snippet: "Washinomiya Shrine" }]);
/** What `web_search` writes for PAGE. */
const WRITTEN = wrapperText([{ title: "Lucky Star", body: "Washinomiya Shrine", href: "https://example.test/", source_tier: "unverified" }]);
const STORED_TEXT = "Text stored with the result";
const AMBIGUOUS = { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [
  { bangumi_id: "485", title: "First title with a long catalog description ".repeat(2) },
  { bangumi_id: "2907", title: "Second title with a long catalog description ".repeat(2) },
] };

function toolTexts(messages: readonly AgentMessage[]) {
  return messages.flatMap((message) => message.role === "toolResult"
    ? [message.content.map((part) => part.type === "text" ? part.text : "").join("")] : []);
}

/** A model step that records the tool texts of the request it answers, then ends the turn. */
function capture(contexts: string[][]): FauxResponseStep {
  return (context) => { contexts.push(toolTexts(context.messages)); return fauxAssistantMessage("Done."); };
}

/** A pilgrimage harness on a fresh session: searches answer with PAGE, the catalog with an ambiguous title. */
async function pilgrimage(responses: FauxResponseStep[]) {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json(AMBIGUOUS)));
  toolContext.webFetch = () => Promise.resolve(new Response(PAGE));
  const { harness } = await pilgrimageHarnessFor(toolContext, responses);
  return { repo, session, harness, lane: await harness.lane("main", BACKGROUND_CONTEXT) };
}

/** Every tool result from here on is stored with STORED_TEXT as its text; its details stay as written. */
function storeOtherText(harness: Harness) {
  harness.hooks.on("after_tool", () => ({ content: [{ type: "text", text: STORED_TEXT }] }));
}

void test("a web result reaches the model rendered from its details in its own turn and a later one, and its stored entry keeps its text", async () => {
  const contexts: string[][] = [];
  const { repo, session, harness, lane } = await pilgrimage([SEARCH, capture(contexts), SEARCH, capture(contexts)]);
  storeOtherText(harness);
  try {
    getOrThrow(await lane.prompt("Search", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await lane.prompt("Search again", undefined, BACKGROUND_CONTEXT));
    assert.deepEqual(contexts, [[WRITTEN], [WRITTEN, WRITTEN]]);
    const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
    assert.deepEqual(entries.flatMap((entry) => entry.type === "message" ? toolTexts([entry.message]) : []), [STORED_TEXT, STORED_TEXT]);
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});

void test("another tool's frozen summary still applies beside a rendered web result", async () => {
  const contexts: string[][] = [];
  const { repo, harness, lane } = await pilgrimage([RESOLVE, fauxAssistantMessage("Which one?"), SEARCH, capture(contexts)]);
  try {
    getOrThrow(await lane.prompt("Find Lucky Star", undefined, BACKGROUND_CONTEXT));
    storeOtherText(harness);
    getOrThrow(await lane.prompt("Search the web", undefined, BACKGROUND_CONTEXT));
    assert.deepEqual(contexts, [['[resolve_anime: ambiguous, ordered_candidates=["485","2907"]]', WRITTEN]]);
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});

void test("a web result reaches the model rendered from its details when the agent status cannot be built", async (t) => {
  const contexts: string[][] = [];
  const { repo, session, harness, lane } = await pilgrimage([SEARCH, capture(contexts)]);
  t.mock.method(session, "branch", () => Promise.resolve(undefined));
  storeOtherText(harness);
  try {
    getOrThrow(await lane.prompt("Search", undefined, BACKGROUND_CONTEXT));
    assert.deepEqual(contexts, [[WRITTEN]]);
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});
