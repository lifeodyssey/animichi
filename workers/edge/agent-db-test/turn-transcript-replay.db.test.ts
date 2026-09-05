/**
 * #1377 against real PostgreSQL: a later turn's context really carries an
 * EARLIER turn's tool call and its result (spec §九 9.1).
 *
 * Only a database can answer this one. The claim is about a statement — the
 * steps of every run the transcript names are loaded, keyed on `run_steps`'
 * own primary key — and about the `messages.response_data` envelope surviving
 * a round trip through `jsonb`. A double would restate both.
 *
 * The model is the W0-S1 provider double, so this is the REAL pi loop: what is
 * asserted is the message list pi was handed on the second turn's first
 * request, not a flag.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { CountingSpotLookup, makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { makeToolCallMessage } from "../test/doubles/make-loaded-turn.ts";
import { makeToolCallingStreamFn } from "../test/doubles/pi-provider-double.ts";
import { onlyRow, seedSession, type AgentDatabase } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const SESSION = "session-1377";
const OWNER = "do-incarnation-1";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };
const EARLIER_ANSWER = "Takayama, for Hyouka.";
const EARLIER_CALL = makeToolCallMessage("call-earlier");

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

async function insertUserMessage(database: AgentDatabase, text: string): Promise<string> {
  const inserted = await database.execute(
    sql`insert into messages (session_id, role, content) values (${SESSION}, 'user', ${text}) returning id`,
  );
  return String(onlyRow(inserted).id);
}

async function insertRun(database: AgentDatabase, messageId: string, status: string): Promise<string> {
  const finished = status === "running" ? null : new Date().toISOString();
  const inserted = await database.execute(
    sql`insert into runs (session_id, message_id, status, deadline_at, finished_at, payer)
        values (${SESSION}, ${messageId}, ${status}, now() + interval '100 seconds', ${finished}, 'anon')
        returning id`,
  );
  return String(onlyRow(inserted).id);
}

/** One finished turn as its own alarm left it: the settled step, the assistant
 * tool-call message that issued it, and the answer that closed the run. */
async function seedAnsweredTurn(database: AgentDatabase): Promise<void> {
  const runId = await insertRun(database, await insertUserMessage(database, "Hyouka の聖地は？"), "succeeded");
  const result = { content: [{ type: "text", text: EARLIER_ANSWER }], details: null };
  await database.execute(
    sql`insert into run_steps (run_id, step_index, tool_name, input, result, finished_at)
        values (${runId}, 0, 'lookup_spot', '{"title":"Hyouka"}'::jsonb,
                ${JSON.stringify(result)}::jsonb, now())`,
  );
  const envelope = { run_id: runId, step_index: 0, message: EARLIER_CALL };
  await database.execute(
    sql`insert into messages (session_id, role, content, response_data)
        values (${SESSION}, 'assistant', '', ${JSON.stringify(envelope)}::jsonb)`,
  );
  await database.execute(
    sql`insert into messages (session_id, role, content) values (${SESSION}, 'assistant', '高山です')`,
  );
}

/** The turn under test, with the context of every model request it makes. */
function makeSecondTurn(seen: AgentMessage[][]): DurableTurn {
  const scripted = makeToolCallingStreamFn();
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

void test("a second turn is handed the first turn's call and result, structured", async () => {
  await seedSession(plane.database, SESSION);
  await seedAnsweredTurn(plane.database);
  const runId = await insertRun(plane.database, await insertUserMessage(plane.database, "他には？"), "running");
  const seen: AgentMessage[][] = [];
  assert.deepEqual(await makeSecondTurn(seen).run(runId), { phase: "succeeded" });

  const opening = seen[0] ?? [];
  assert.deepEqual(opening.map((message) => message.role), [
    "user", "assistant", "toolResult", "assistant", "user",
  ]);
  assert.deepEqual(opening[1], EARLIER_CALL);
  const answered = opening[2];
  assert.ok(answered?.role === "toolResult", "the first turn's step answered its call");
  assert.deepEqual(answered.content, [{ type: "text", text: EARLIER_ANSWER }]);
});
