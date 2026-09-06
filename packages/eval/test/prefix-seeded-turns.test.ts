/**
 * E-1 (#1380): a seeded case's turns land in the session its prefix went into,
 * and the report says so.
 *
 * The register between the two halves is the property under test. `setup()` and
 * the task are two calls the driver keeps apart, so a prefix seeded into one
 * session and a turn submitted to another would BOTH look like they worked —
 * the seeding answers 200 and the turn answers a stream — and only the score
 * would be wrong. `x-session-id` on the first submission is what makes them one
 * conversation, and `prefix_seeded` on the report is what lets a reader tell a
 * case that started from a frozen prefix from one that did not.
 *
 * test-type: integration (the driver's own case run, over a fake door).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { loadExportedDataset } from "../src/dataset-roundtrip.ts";
import { seededPrefixLifecycle } from "../src/prefix-seeding-lifecycle.ts";
import { SeededSessions } from "../src/seeded-sessions.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { PREFIX_SEEDED_ATTRIBUTE, StagingTurnTask } from "../src/staging-turn-task.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";
import { fakeStagingDoor, type DoorCall } from "./fake-staging-door.ts";

const SEEDED_SESSION = "session-seeded";
const BEARER = new StagingBearer(() => Promise.resolve("qa-token"), () => 0);
const STREAM = 'data: {"type":"finish"}\n\n';
const HISTORY = { messages: [], revision: 1, next_offset: null, run: null, steps: [] };

/** One case of a set, run end to end through the driver with a lifecycle. */
async function runOneCase(setName: string): Promise<{ calls: DoorCall[]; seeded: boolean }> {
  const dataset = await loadExportedDataset<TranscriptResult>(setName);
  dataset.cases = dataset.cases.slice(0, 1);
  const staging = fakeStagingDoor({ stream: STREAM, history: HISTORY, sessionId: "session-minted" });
  const sessions = new SeededSessions();
  const task = new StagingTurnTask({
    door: staging.door, bearer: BEARER, turnId: () => "turn-1", sessions,
  });
  const lifecycle = seededPrefixLifecycle<TranscriptResult>({
    door: staging.door, bearer: BEARER, sessions, sessionId: () => SEEDED_SESSION,
  });
  const report = await dataset.evaluate(task.asTask(), { name: `test_${setName}`, lifecycle });
  const marked = report.cases[0]?.attributes[PREFIX_SEEDED_ATTRIBUTE] === true;
  return { calls: staging.calls, seeded: marked };
}

function chatCalls(calls: readonly DoorCall[]): DoorCall[] {
  return calls.filter((call) => call.path === "/v1/chat");
}

void test("a seeded case submits its turn to the session its prefix went into", async () => {
  const { calls } = await runOneCase("phase1c_selection_v1");

  const [chat] = chatCalls(calls);
  assert.ok(chat !== undefined, "the case submitted a turn");
  assert.equal(chat.headers.get("x-session-id"), SEEDED_SESSION);
});

void test("the seeding runs before the turn, on that same session's path", async () => {
  const { calls } = await runOneCase("phase1c_selection_v1");

  assert.equal(calls[0]?.path, `/v1/staging/sessions/${SEEDED_SESSION}/prefix`);
  assert.equal(calls[1]?.path, "/v1/chat");
});

void test("the report marks a prefix-seeded case as one", async () => {
  const { seeded } = await runOneCase("phase1c_selection_v1");

  assert.equal(seeded, true);
});

void test("an unseeded case names no session and is not marked", async () => {
  const { calls, seeded } = await runOneCase("agent_eval_heldout_v1");

  const [chat] = chatCalls(calls);
  assert.equal(chat?.headers.get("x-session-id"), null);
  assert.equal(seeded, false);
});
