/**
 * W2 follow-up (#1292): the tokens a turn spends OUTSIDE its own pi run, from
 * the call that makes them to the record the settlement commits.
 *
 * `translate_anime_title` falls back to a tool-less completion on the turn's
 * model. That call is made from inside a tool, so the pi Agent never sees its
 * `message_end` and `TurnOutput` — which is fed by those events alone — cannot
 * count it: before this seam the tokens were metered nowhere at all. Three
 * things therefore have to hold, and each is a case below: the toolbox that
 * made the call can say what it cost, a toolbox that made none says nothing,
 * and the ending carries the figure separately from the run's own usage,
 * because the two may be charged to different scopes.
 *
 * WHO PAYS is the last case. It is a pure decision over the run's committed
 * payer, and `agent-db-test/turn-settlement.db.test.ts` is where the day rows
 * it produces are proven against real PostgreSQL.
 *
 * test-type: unit (fake clock, scripted socket, scripted catalog; no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { supplementalScope } from "../src/agent/settlement/supplemental-usage.ts";
import type { TurnUsage } from "../src/agent/settlement/turn-settlement.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  CountingSpotLookup,
  makeScriptedTurnModel,
  makeSessionTurnParts,
  makeUserTranscript,
} from "./doubles/make-turn-parts.ts";

const RUN_ID = "run-1";
const NOW = 1_000;
const TRANSLATE_TOOL = "translate_anime_title";
const TRANSLATION_SPEND: TurnUsage = { requests: 1, inputTokens: 250, outputTokens: 12 };
const NOTHING_SPENT: TurnUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

/** A catalog that resolves nothing, so the chain falls past `title_cn` to the
 * model — the only branch that reaches a provider at all. */
function catalogWithoutTheTitle(): { fetch: (request: Request) => Promise<Response> } {
  return {
    fetch: () => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" })),
  };
}

/** One finished translation, with the tokens the provider says it cost. */
function makeTranslatedMessage(model: Model<Api>, spend: TurnUsage): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "冰菓" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: spend.inputTokens,
      output: spend.outputTokens,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: spend.inputTokens + spend.outputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

/** A socket that answers every completion with that one message. */
function makeTranslatingStreamFn(spend: TurnUsage) {
  return (model: Model<Api>) => {
    const events = createAssistantMessageEventStream();
    events.push({ type: "done", reason: "stop", message: makeTranslatedMessage(model, spend) });
    return events;
  };
}

/** The turn's own toolbox, over a catalog that knows nothing and a socket that
 * always translates. */
function makeTranslatingToolbox(spend: TurnUsage) {
  const session = new TurnCatalogSession({ locale: "ja" });
  const model = makeScriptedTurnModel(makeTranslatingStreamFn(spend));
  return turnToolbox({ CATALOG: catalogWithoutTheTitle() }, session, model);
}

async function translateOn(toolbox: ReturnType<typeof makeTranslatingToolbox>): Promise<void> {
  const tool = toolbox.tools().find((registered) => registered.name === TRANSLATE_TOOL);
  assert.ok(tool !== undefined, "the turn must register the translation tool");
  await tool.execute("call-1", { title: "Hyouka", target_language: "zh" }, undefined);
}

// ── what the toolbox can answer for ────────────────────────────────────────

void test("the toolbox reports the tokens its tool-less translation spent", async () => {
  const toolbox = makeTranslatingToolbox(TRANSLATION_SPEND);
  await translateOn(toolbox);
  assert.deepEqual(toolbox.spent(), TRANSLATION_SPEND);
});

void test("two translations in one turn add up rather than replace each other", async () => {
  const toolbox = makeTranslatingToolbox(TRANSLATION_SPEND);
  await translateOn(toolbox);
  await translateOn(toolbox);
  assert.deepEqual(toolbox.spent(), { requests: 2, inputTokens: 500, outputTokens: 24 });
});

void test("a toolbox that never translated spends nothing off-run", () => {
  assert.deepEqual(makeTranslatingToolbox(TRANSLATION_SPEND).spent(), NOTHING_SPENT);
});

// ── what the ending commits ────────────────────────────────────────────────

function makeTurn(toolbox: CountingSpotLookup): { store: InMemoryTurnStore; turn: DurableTurn } {
  const now = () => NOW;
  const store = new InMemoryTurnStore(
    {
      runId: RUN_ID,
      sessionId: "session-1",
      deadlineAt: NOW + 100_000,
      transcript: makeUserTranscript(),
      steps: [],
    },
    now,
  );
  const parts = {
    store, model: makeScriptedTurnModel(), toolbox, ...makeSessionTurnParts(),
    systemPrompt: "test", prices: { inputUsdPerMtok: 1, outputUsdPerMtok: 2 },
    emit: () => Promise.resolve(), owner: "do-incarnation-1", now,
  };
  return { store, turn: new DurableTurn(parts) };
}

void test("the settled record carries the off-run spend beside the run's own", async () => {
  const toolbox = new CountingSpotLookup();
  toolbox.offRunUsage = TRANSLATION_SPEND;
  const { store, turn } = makeTurn(toolbox);
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  const settled = store.succeeded[0];
  assert.ok(settled !== undefined, "a succeeded turn commits exactly one record");
  assert.deepEqual(settled.supplemental, TRANSLATION_SPEND);
  assert.notDeepEqual(settled.usage, TRANSLATION_SPEND);
  assert.deepEqual(store.succeededAt, [new Date(NOW)]);
});

void test("a turn whose tools reached no provider settles nothing extra", async () => {
  const { store, turn } = makeTurn(new CountingSpotLookup());
  await turn.run(RUN_ID);
  assert.deepEqual(store.succeeded[0]?.supplemental, NOTHING_SPENT);
});

// ── who pays for it ────────────────────────────────────────────────────────

void test("a caller-keyed turn's off-run spend is charged to the platform", () => {
  assert.equal(supplementalScope("byok"), "platform");
});

void test("every other turn charges its off-run spend to its own scope", () => {
  assert.equal(supplementalScope("anon"), "anon");
  assert.equal(supplementalScope("user"), "user");
});
