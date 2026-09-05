/**
 * #1389 against real PostgreSQL: turn 2 answers about turn 1's route without
 * planning it again (spec §九 9.2).
 *
 * Only a database can answer this one. Turn 1's route lives in
 * `run_steps.result` — the raw outcome, and beside it the summary frozen when
 * the step was written — and turn 2 is a DIFFERENT run, so what it is shown is
 * whatever `loadRunningTurn` reads back out of those rows. The catalog counts
 * the routes it was asked to plan, so "turn 2 did not re-plan" is measured
 * rather than asserted about a flag.
 *
 * Both turns run the REAL pi loop, the real catalog tools and the real step
 * persistence; only the provider socket and the `CATALOG` binding are scripted.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { TWELVE_STOP_IDS, TWELVE_STOP_ROUTE, WASHINOMIYA } from "../test/doubles/catalog-payloads.ts";
import { makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "../test/doubles/pi-provider-double.ts";
import { onlyRow, seedSession } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const SESSION = "session-1389-two-turns";
const OWNER = "do-incarnation-1389";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };
const SEARCH_CALL: ScriptedToolCall = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const TWELVE_ROWS = TWELVE_STOP_IDS.map((id) => ({ ...WASHINOMIYA, id }));

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

/** A `CATALOG` binding answering the two procedures these turns reach, and
 * counting the routes it was asked to plan. */
class CountingCatalogBinding {
  planned = 0;

  fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/catalog/itinerary") {
      return Promise.resolve(Response.json({ rows: TWELVE_ROWS, synced_at: null }));
    }
    this.planned += 1;
    return Promise.resolve(Response.json(TWELVE_STOP_ROUTE));
  }
}

/** One `running` run of this session, over its own user message. */
async function openRun(text: string): Promise<string> {
  const message = await plane.database.execute(
    sql`insert into messages (session_id, role, content) values (${SESSION}, 'user', ${text}) returning id`,
  );
  const run = await plane.database.execute(
    sql`insert into runs (session_id, message_id, deadline_at, payer)
        values (${SESSION}, ${String(onlyRow(message).id)}, now() + interval '100 seconds', 'anon')
        returning id`,
  );
  return String(onlyRow(run).id);
}

/** One alarm's turn, on its own session object — a fresh incarnation's heap. */
function makeTurn(
  catalog: CountingCatalogBinding, runId: string, calls: ScriptedToolCall[], seen: AgentMessage[][],
): DurableTurn {
  const session = new TurnCatalogSession({ runId, locale: "ja" });
  const scripted = makeSequencedToolCallsStreamFn(calls);
  const model = makeScriptedTurnModel((request, context, options) => {
    seen.push([...context.messages] as AgentMessage[]);
    return scripted(request, context, options);
  });
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model,
    toolbox: turnToolbox({ CATALOG: catalog }, session, model),
    ...makeSessionTurnParts(session),
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: Date.now,
  });
}

/** Turn 1: search the work, then route all twelve of its points. */
async function planTwelveStops(catalog: CountingCatalogBinding): Promise<string> {
  await seedSession(plane.database, SESSION);
  const runId = await openRun("らき☆すたの聖地を回りたい");
  const plan: ScriptedToolCall = {
    name: "plan_route",
    arguments: { search_result_ref: `search:12:1@${runId}` },
  };
  assert.deepEqual(await makeTurn(catalog, runId, [SEARCH_CALL, plan], []).run(runId), { phase: "succeeded" });
  return runId;
}

/** The short form turn 1's route step was written down with. */
async function frozenRouteSummary(runId: string): Promise<string> {
  const stored = onlyRow(await plane.database.execute(
    sql`select result ->> 'summary' as summary from run_steps
        where run_id = ${runId} and tool_name = 'plan_route'`,
  ));
  return String(stored.summary);
}

/** Every tool return's text in one context, joined. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

void test("turn 1 writes the route down with its twelve stop ids in order", async () => {
  const summary = await frozenRouteSummary(await planTwelveStops(new CountingCatalogBinding()));
  assert.match(summary, /^\[plan_route: itinerary_ref=route:12:2@/);
  assert.ok(summary.includes(JSON.stringify(TWELVE_STOP_IDS)), summary);
});

void test("turn 2 reads that route back without asking the catalog again", async () => {
  const catalog = new CountingCatalogBinding();
  const summary = await frozenRouteSummary(await planTwelveStops(catalog));
  const seen: AgentMessage[][] = [];
  const second = await openRun("2 番目の場所は？");

  assert.deepEqual(await makeTurn(catalog, second, [], seen).run(second), { phase: "succeeded" });
  assert.equal(returnTextsIn(seen[0] ?? []).includes(summary), true);
  assert.ok(returnTextsIn(seen[0] ?? []).includes(JSON.stringify(TWELVE_STOP_IDS)), "stops in order");
  assert.equal(catalog.planned, 1);
});
