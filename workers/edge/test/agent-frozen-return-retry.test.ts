/**
 * #1378, the crash-resume half: what a RETRIED attempt of one run is shown, and
 * what it leaves on the ledger (spec §九 9.2 (1) and (5)).
 *
 * Two claims only a real crash/retry pair can make. First, the retry is shown
 * the returns the crashed attempt was shown, byte for byte: a settled step of
 * THIS run replays WHOLE (`frozen-tool-return.ts`), never as its frozen
 * summary, because the attempt being resumed handed the model the full return
 * and a resumed loop must not find itself in a different conversation. Second,
 * the entity rescue survives the crash: the envelope is promoted only when the
 * run reaches a terminal path, so an attempt that crashed after settling a step
 * rescued into a ledger nobody kept — and the retry, which REPLAYS that step
 * instead of executing it, has to rescue it again. The ledger's dedup is what
 * makes once-per-attempt read as once.
 *
 * The pair runs over the REAL pi loop, the real step persistence and the real
 * catalog tools; only the provider socket and the `CATALOG` binding are
 * scripted.
 *
 * test-type: integration (real pi loop + scripted provider/catalog, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DurableEnvelopeStore } from "../src/agent/session/durable-envelope-store.ts";
import type { RetainedEntity } from "../src/agent/memory/retained-entity-ledger.ts";
import { TurnStoreUnavailable } from "../src/agent/session/run-machine.ts";
import type { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  makeEnvelopeTurnStore,
  runEnvelopeTurn,
  type EnvelopeTurnParts,
  type EnvelopeTurnRun,
} from "./doubles/make-envelope-turn.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "./doubles/pi-provider-double.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const TITLE = "らき☆すた";
const RESOLVE_CALL = { name: "resolve_anime", arguments: { title: TITLE } };
const SEARCH_CALL = { name: "search_bangumi", arguments: { bangumi_id: "1" } };

/** A disambiguation wide enough that its own JSON is over the 200-char cap, so
 * the step that settles it freezes a summary and rescues the title typed. */
const WIDE_AMBIGUITY = {
  outcome: "needs_disambiguation",
  candidates: Array.from({ length: 30 }, (_unused, index) => ({
    bangumi_id: `900${String(index)}`,
    title: `${TITLE} ${String(index)}`,
  })),
};

/** The scripted socket, with every context it was handed kept — a crashed turn
 * throws before `runEnvelopeTurn` can hand its own recording back. */
function recordingStream(
  calls: readonly ScriptedToolCall[], seen: AgentMessage[][],
): EnvelopeTurnParts["streamFn"] {
  const scripted = makeSequencedToolCallsStreamFn(calls);
  return (model, context, options) => {
    seen.push([...context.messages] as AgentMessage[]);
    return scripted(model, context, options);
  };
}

/** Every tool return's text in one context — what a replay has to reproduce. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

/**
 * The attempt that settled `resolve_anime` and crashed before the search
 * landed: the store refuses step 1, so step 0 and the assistant message that
 * opened it stay put and the run stays `running`.
 */
async function crashedAfterResolve(
  storage: RecordingEnvelopeStorage, seen: AgentMessage[][],
): Promise<InMemoryTurnStore> {
  const store = makeEnvelopeTurnStore();
  store.refuseStepsFrom = 1;
  const streamFn = recordingStream([RESOLVE_CALL, SEARCH_CALL], seen);
  const parts = { storage, store, streamFn, resolveOutcome: WIDE_AMBIGUITY };
  await assert.rejects(runEnvelopeTurn(parts), TurnStoreUnavailable);
  store.refuseStepsFrom = Number.POSITIVE_INFINITY;
  return store;
}

/** The retry of that same run, over the same store and the same storage. */
function retryOf(storage: RecordingEnvelopeStorage, store: InMemoryTurnStore): Promise<EnvelopeTurnRun> {
  const streamFn = makeSequencedToolCallsStreamFn([SEARCH_CALL]);
  return runEnvelopeTurn({ storage, store, streamFn, resolveOutcome: WIDE_AMBIGUITY });
}

/** What the session's promoted envelope retained. */
async function retainedIn(storage: RecordingEnvelopeStorage): Promise<readonly RetainedEntity[]> {
  const loaded = await new DurableEnvelopeStore(storage).load();
  return loaded.memory.retainedEntities.entities;
}

void test("a retry rescues the entity the crashed attempt never got to promote", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = await crashedAfterResolve(storage, []);
  assert.deepEqual(await retainedIn(storage), [], "the crash promoted no envelope");

  assert.deepEqual((await retryOf(storage, store)).state, { phase: "succeeded" });
  assert.deepEqual(await retainedIn(storage), [{ toolName: "resolve_anime", value: TITLE }]);
});

void test("the retry is shown the whole return its crashed attempt already saw", async () => {
  const storage = new RecordingEnvelopeStorage();
  const seen: AgentMessage[][] = [];
  const store = await crashedAfterResolve(storage, seen);
  const answered = returnTextsIn(seen[1] ?? []);

  const retry = await retryOf(storage, store);
  assert.match(answered, /clarification_reason/, "the crashed attempt saw the raw return");
  assert.equal(returnTextsIn(retry.requests[0]?.messages ?? []), answered);
});
