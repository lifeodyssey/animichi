/**
 * #1378 against real PostgreSQL: the frozen summary is written into
 * `run_steps.result` and read back out of it (spec §九 9.2).
 *
 * Only a database can answer this one. The summary is an ADDITIVE key inside
 * the existing `result` jsonb — §三's persistence granularity is unchanged and
 * no migration was needed — so the claim is that the very statements Neon runs
 * carry it: `insertStep` stringifies it in, `selectSteps` hands it back beside
 * an untouched raw `content`, and the rebuild replays that string. A double
 * would restate all three.
 *
 * The model is the W0-S1 provider double, so this is the REAL pi loop.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { TOOL_RETURN_MAX_CHARS } from "../src/agent/session/tool-return-summary.ts";
import { CountingSpotLookup, makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { makeToolCallMessage } from "../test/doubles/make-loaded-turn.ts";
import { makeSequencedToolCallsStreamFn } from "../test/doubles/pi-provider-double.ts";
import { onlyRow, seedSession } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const WRITTEN = "session-1378-written";
const REPLAYED = "session-1378-replayed";
const OWNER = "do-incarnation-1";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };
/** A title long enough that `lookup_spot`'s answer is over the cap. */
const LONG_TITLE = "氷菓".repeat(TOOL_RETURN_MAX_CHARS);
const EARLIER_CALL = makeToolCallMessage("call-earlier");
const RAW_RETURN = JSON.stringify({ outcome: "ok", rows: Array.from({ length: 40 }, () => "spot") });
const FROZEN = "[lookup_spot: completed]";

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

async function insertRun(sessionId: string, status: string, text: string): Promise<string> {
  const message = await plane.database.execute(
    sql`insert into messages (session_id, role, content) values (${sessionId}, 'user', ${text}) returning id`,
  );
  const finished = status === "running" ? null : new Date().toISOString();
  const inserted = await plane.database.execute(
    sql`insert into runs (session_id, message_id, status, deadline_at, finished_at, payer)
        values (${sessionId}, ${String(onlyRow(message).id)}, ${status},
                now() + interval '100 seconds', ${finished}, 'anon')
        returning id`,
  );
  return String(onlyRow(inserted).id);
}

/** One finished turn whose long return was frozen when it was written. */
async function seedFrozenTurn(sessionId: string): Promise<void> {
  await seedSession(plane.database, sessionId);
  const runId = await insertRun(sessionId, "succeeded", "Hyouka の聖地は？");
  const result = { content: [{ type: "text", text: RAW_RETURN }], details: null, summary: FROZEN };
  await plane.database.execute(
    sql`insert into run_steps (run_id, step_index, tool_name, input, result, finished_at)
        values (${runId}, 0, 'lookup_spot', '{"title":"Hyouka"}'::jsonb,
                ${JSON.stringify(result)}::jsonb, now())`,
  );
  const envelope = { run_id: runId, step_index: 0, message: EARLIER_CALL };
  await plane.database.execute(
    sql`insert into messages (session_id, role, content, response_data)
        values (${sessionId}, 'assistant', '', ${JSON.stringify(envelope)}::jsonb)`,
  );
}

/** The turn under test, with the context of every model request it makes. */
function makeTurn(seen: AgentMessage[][], title: string): DurableTurn {
  const scripted = makeSequencedToolCallsStreamFn([{ name: "lookup_spot", arguments: { title } }]);
  const model = makeScriptedTurnModel((request, context, options) => {
    seen.push([...context.messages] as AgentMessage[]);
    return scripted(request, context, options);
  });
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model,
    ...makeSessionTurnParts(),
    toolbox: new CountingSpotLookup(),
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: Date.now,
  });
}

/** What one run's only step stored, raw text and frozen summary apart. */
async function storedStep(runId: string): Promise<Record<string, unknown>> {
  return onlyRow(await plane.database.execute(
    sql`select result ->> 'summary' as summary, result -> 'content' -> 0 ->> 'text' as raw
        from run_steps where run_id = ${runId} and step_index = 0`,
  ));
}

void test("a long return is written down with its frozen summary beside the raw text", async () => {
  await seedSession(plane.database, WRITTEN);
  const runId = await insertRun(WRITTEN, "running", "聖地は？");
  assert.deepEqual(await makeTurn([], LONG_TITLE).run(runId), { phase: "succeeded" });

  const stored = await storedStep(runId);
  assert.equal(stored.summary, FROZEN);
  assert.match(String(stored.raw), /^Takayama, for 氷菓/);
});

void test("a later turn replays the stored summary, not the raw return", async () => {
  await seedFrozenTurn(REPLAYED);
  const runId = await insertRun(REPLAYED, "running", "他には？");
  const seen: AgentMessage[][] = [];
  assert.deepEqual(await makeTurn(seen, "Hyouka").run(runId), { phase: "succeeded" });

  const answered = (seen[0] ?? [])[2];
  assert.ok(answered?.role === "toolResult", "the earlier turn's step answered its call");
  assert.deepEqual(answered.content, [{ type: "text", text: FROZEN }]);
});
