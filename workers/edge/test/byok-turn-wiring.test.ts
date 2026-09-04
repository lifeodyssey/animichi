import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { ProviderFailure, RunMachine } from "../src/agent/session/run-machine.ts";
import { TurnAttempt } from "../src/agent/session/turn-attempt.ts";
import type { TurnFrame } from "../src/agent/session/turn-frames.ts";
import { scrubbedFrames } from "../src/agent/session/turn-subscribers.ts";
import { REDACTED, SecretScrub } from "../src/agent/egress/secret-scrub.ts";
import { mimoTurnModel, type TurnModel } from "../src/agent/session/turn-model.ts";
import { turnFrameSink, turnModelFor } from "../src/agent/session/session-turn.ts";
import type { ByokCredential } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";
import { byokTurnModel } from "../src/agent/byok/byok-turn-model.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  CountingSpotLookup,
  makeScriptedTurnModel,
  makeSessionTurnParts,
  makeUserTranscript,
} from "./doubles/make-turn-parts.ts";
import {
  makeRejectedRequestStreamFn,
  makeSequencedToolCallsStreamFn,
} from "./doubles/pi-provider-double.ts";

// W2-3 (#1289) — a BYOK credential wired through the turn the alarm drives.
// The turn machinery is the REAL one (`DurableTurn` over the real pi loop);
// what changes is only which model it was handed.
//
// test-type: unit (fake clock; no network, no database).

const FIXTURE_KEY = "byok-test-key-0000";
const RUN_ID = "run-1";
const NOW = 1_000;
const DEADLINE = NOW + 100_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };

function credential(): ByokCredential {
  const parsed = byokCredentialIn(new Headers({
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": FIXTURE_KEY,
  }));
  assert.ok(parsed !== null, "the fixture headers must parse");
  return parsed;
}

/** A BYOK turn's model with its socket scripted: the credential decides the
 * scrub, the double decides what the model says. */
function makeScriptedByokModel(streamFn: Parameters<typeof makeScriptedTurnModel>[0]): TurnModel {
  const scrub = byokTurnModel(credential()).scrub;
  return { ...makeScriptedTurnModel(streamFn), callerKeyed: true, scrub };
}

function makeStore(steps: ConstructorParameters<typeof InMemoryTurnStore>[0]["steps"] = []) {
  const seed = {
    runId: RUN_ID,
    sessionId: "session-1",
    deadlineAt: DEADLINE,
    transcript: makeUserTranscript(),
    steps,
  };
  return new InMemoryTurnStore(seed, () => NOW);
}

function makeParts(store: InMemoryTurnStore, model: TurnModel, emit: (frames: readonly TurnFrame[]) => Promise<void>) {
  return {
    store,
    model,
    toolbox: new CountingSpotLookup(),
    ...makeSessionTurnParts(),
    systemPrompt: "test",
    prices: PRICES,
    emit,
    owner: "do-1",
    now: () => NOW,
  };
}

// ── the credential decides the model, and only that ────────────────────────

void test("only the BYOK model carries a guarded fetch and a scrub; the server-key one carries neither", () => {
  const byok = byokTurnModel(credential());
  const mimo = mimoTurnModel("server-key-0000");
  assert.notEqual(byok.fetch, undefined);
  assert.notEqual(byok.scrub, undefined);
  assert.equal(mimo.fetch, undefined);
  assert.equal(mimo.scrub, undefined);
});

// ── the one branch the red line forbids ────────────────────────────────────

/** The environment a deployment with a working server key looks like. */
const SERVER_KEYED = { MIMO_API_KEY: "server-key-0000" };

void test("a BYOK turn runs on the caller's key even where a server key is configured", () => {
  const chosen = turnModelFor(SERVER_KEYED, credential());
  assert.ok(chosen !== null, "a BYOK turn always has a model");
  assert.equal(chosen.model.provider, "anthropic", "never the server's own mimo model");
  assert.notEqual(chosen.scrub, undefined);
});

void test("a turn with no credential of either kind gets no model at all", () => {
  assert.equal(turnModelFor({}, undefined), null);
});

void test("a plain turn still runs on the server key exactly as it did before", () => {
  const chosen = turnModelFor(SERVER_KEYED, undefined);
  assert.ok(chosen !== null, "a configured server key always yields a model");
  assert.equal(chosen.model.provider, "mimo");
});

void test("a BYOK turn's frames are wrapped in its scrub; a plain turn's sink is untouched", () => {
  const emit = () => Promise.resolve();
  assert.notEqual(turnFrameSink(emit, byokTurnModel(credential())), emit);
  assert.equal(turnFrameSink(emit, mimoTurnModel("server-key-0000")), emit);
});

// ── replay: a settled step is answered from the ledger, not re-sent ────────

void test("a replayed step on a BYOK turn is answered from run_steps and never re-executed", async () => {
  const settled = { content: [{ type: "text" as const, text: "cached" }], details: null };
  const store = makeStore([
    { stepIndex: 0, toolName: "lookup_spot", input: { title: "Hyouka" }, result: settled },
  ]);
  const parts = makeParts(store, makeScriptedByokModel(undefined), () => Promise.resolve());
  assert.deepEqual(await new DurableTurn(parts).run(RUN_ID), { phase: "succeeded" });
  assert.equal(parts.toolbox.calls, 0, "the tool must not run a second time");
  assert.equal(store.steps.length, 1);
});

// ── the key never rides a frame ────────────────────────────────────────────

void test("a frame carrying text that echoes the caller's key is redacted before it is pushed", async () => {
  const store = makeStore();
  const echoed = `key ${FIXTURE_KEY} seen`;
  const model = makeScriptedByokModel(
    makeSequencedToolCallsStreamFn([{ name: "lookup_spot", arguments: { title: echoed } }]),
  );
  const pushed: TurnFrame[] = [];
  const scrub = model.scrub ?? new SecretScrub();
  const emit = scrubbedFrames((frames) => {
    pushed.push(...frames);
    return Promise.resolve();
  }, scrub);
  await new DurableTurn(makeParts(store, model, emit)).run(RUN_ID);
  const text = JSON.stringify(pushed);
  assert.equal(text.includes(FIXTURE_KEY), false, "no frame may carry the caller's key");
  assert.equal(text.includes(REDACTED), true, "the echoed key must be visibly redacted");
});

// ── the key never rides a provider failure ─────────────────────────────────

void test("a provider error that echoes the key becomes a failure whose text is redacted", async () => {
  const store = makeStore();
  const message = `401 unauthorized: ${FIXTURE_KEY}`;
  const model = makeScriptedByokModel(makeRejectedRequestStreamFn(message));
  const loaded = await store.loadRunningTurn(RUN_ID);
  assert.ok(loaded !== null, "the seeded run must load");
  const machine = new RunMachine(DEADLINE, () => NOW);
  machine.claim(true);
  const attempt = new TurnAttempt(loaded, machine, makeParts(store, model, () => Promise.resolve()));
  const thrown = await attempt.drive().then(() => null, (error: unknown) => error);
  assert.ok(thrown instanceof ProviderFailure);
  assert.equal(thrown.message.includes(FIXTURE_KEY), false);
  assert.equal(thrown.message.includes(REDACTED), true);
});
