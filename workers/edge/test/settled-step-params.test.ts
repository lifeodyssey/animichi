/**
 * E-2 (#1381): the two witnesses of one tool call, and where each comes from.
 *
 * A model's tool arguments are its own account of what it did. What the tool
 * ran with is the environment's: pi validates and coerces the arguments before
 * `execute` sees them (`validateToolArguments` — a clone, optional nulls
 * dropped, JSON-Schema coercion), and `run_steps.input` is that product. The
 * spec's second witness (§十 10.2, owner decision #1311) is the pair, so this
 * suite holds the two apart:
 *
 * - the SD-9 stream keeps publishing the RAW arguments, unchanged by this card;
 * - the retrieval publishes the SETTLED params, read off the step record and
 *   never off the assistant message that issued the call.
 *
 * A projection that backfilled one from the other would publish one record
 * twice — the metric would then compare a self-statement with itself, which is
 * what it exists not to do.
 *
 * test-type: unit (in-memory records, no database, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { framesFor } from "../src/agent/session/turn-frames.ts";
import {
  readConversation,
  type ConversationFacts,
  type ConversationRecords,
  type SettledStepRow,
  type TranscriptRow,
} from "../src/agent/retrieval/conversation-retrieval.ts";

const OWNER = "user-1";
const SESSION = "s-1";
const RUN_ID = "0199ab00-1111-7000-8000-000000000001";
const EARLIER_RUN_ID = "0199ab00-1111-7000-8000-000000000000";

/** What the model asked for: a string where the tool's schema wants a number. */
const RAW_ARGUMENTS = { bangumi_id: "12345", radius_m: null };

/** What the tool ran with, after pi settled those arguments. */
const SETTLED_PARAMS = '{"bangumi_id": 12345}';

/** The assistant row #1386 writes for the call: the raw arguments, verbatim,
 * under the run that issued them. */
function makeToolCallRow(runId: string = RUN_ID): TranscriptRow {
  const message = { role: "assistant", toolCalls: [{ name: "search_bangumi", arguments: RAW_ARGUMENTS }] };
  return {
    role: "assistant",
    content: "",
    responseData: { run_id: runId, step_index: 0, message },
    createdAt: "2026-08-01T10:00:01Z",
  };
}

function makeStepRow(overrides: Partial<SettledStepRow> = {}): SettledStepRow {
  return { runId: RUN_ID, stepIndex: 0, toolName: "search_bangumi", params: SETTLED_PARAMS, ...overrides };
}

function makeFacts(): ConversationFacts {
  return {
    ownerId: OWNER,
    turnCount: 1,
    latestRun: { runId: RUN_ID, status: "succeeded", failureReason: null },
  };
}

/** One session whose transcript carries the call and whose steps carry what it
 * settled with. The store answers only for the runs it is asked about, as the
 * SQL does, so a scope the use case gets wrong is a step that goes missing. */
function makeRecords(steps: SettledStepRow[], rows = [makeToolCallRow()]): ConversationRecords {
  return {
    factsOf: () => Promise.resolve(makeFacts()),
    transcriptOf: () => Promise.resolve(rows),
    settledStepsOf: (_sessionId, runIds) =>
      Promise.resolve(steps.filter((step) => runIds.includes(step.runId))),
  };
}

function read(steps: SettledStepRow[], rows?: TranscriptRow[]) {
  return readConversation(makeRecords(steps, rows), { sessionId: SESSION, identityId: OWNER });
}

/** A user row: it names no run, so a page of these scopes to the latest run. */
function makePlainRow(): TranscriptRow {
  return { role: "user", content: "秩父の聖地を回りたい", responseData: null, createdAt: "2026-08-01T10:00:00Z" };
}

void test("the settled params are published as the step recorded them", async () => {
  const page = await read([makeStepRow()]);
  assert.deepEqual(page?.steps, [
    { run_id: RUN_ID, step_index: 0, tool_name: "search_bangumi", params: SETTLED_PARAMS },
  ]);
});

void test("the published params are the tool's, not the arguments the model asked with", async () => {
  const page = await read([makeStepRow()]);
  assert.notDeepEqual(JSON.parse(page?.steps?.[0]?.params ?? "null"), RAW_ARGUMENTS);
});

void test("the raw arguments stay on the stream, where the model's own account belongs", () => {
  const frames = framesFor({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "search_bangumi",
    args: RAW_ARGUMENTS,
  });
  assert.deepEqual(frames[1], {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "search_bangumi",
    input: RAW_ARGUMENTS,
  });
});

void test("the transcript row that issued the call publishes no envelope of its own", async () => {
  const page = await read([makeStepRow()]);
  assert.equal(page?.messages[0]?.response_data, null);
});

void test("each run's steps stay under the run that numbered them", async () => {
  const earlier = makeStepRow({ runId: EARLIER_RUN_ID, params: '{"title": "ハルヒ"}', toolName: "resolve_anime" });
  const rows = [makeToolCallRow(EARLIER_RUN_ID), makeToolCallRow()];
  const page = await read([earlier, makeStepRow(), makeStepRow({ stepIndex: 1, toolName: "plan_route" })], rows);
  assert.deepEqual(
    page?.steps?.map((step) => [step.run_id, step.step_index, step.tool_name]),
    [
      [EARLIER_RUN_ID, 0, "resolve_anime"],
      [RUN_ID, 0, "search_bangumi"],
      [RUN_ID, 1, "plan_route"],
    ],
  );
});

void test("a session whose runs settled no step publishes an empty list, not an absent one", async () => {
  const page = await read([]);
  assert.deepEqual(page?.steps, []);
});

/** The bound the pagination forces: `run_steps` has no page of its own, so a
 * page that shows none of an earlier run's calls must not ship its steps. */
void test("a page showing no call of an earlier run does not carry that run's steps", async () => {
  const earlier = makeStepRow({ runId: EARLIER_RUN_ID, params: '{"title": "ハルヒ"}', toolName: "resolve_anime" });
  const page = await read([earlier, makeStepRow()], [makePlainRow()]);
  assert.deepEqual(page?.steps?.map((step) => step.run_id), [RUN_ID]);
});

/** The latest run rides along whatever the page shows: it is the run a client
 * that left mid-turn came back for. */
void test("the latest run's steps are on the page even when none of its calls are", async () => {
  const page = await read([makeStepRow()], [makePlainRow()]);
  assert.deepEqual(page?.steps?.map((step) => step.tool_name), ["search_bangumi"]);
});
