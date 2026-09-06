/**
 * E-1 (#1380): which cases get a starting point, and what happens when one
 * cannot be given.
 *
 * The cases are the real exported ones, not invented ones: membership is
 * "carries `seeded_pending`", and the point of reading the fixtures is that a
 * dataset change moves this test rather than leaving it agreeing with a copy of
 * itself. `phase1c_selection_v1` is the whole of today's list — five cases —
 * and `agent_eval_heldout_v1` is the control that must reach the door zero
 * times.
 *
 * test-type: integration (the driver's own lifecycle contract, over a fake door).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Case } from "logfire/evals";
import { SeedTrajectoryPrefixRequest } from "@animichi/contract/staging-prefix-contract";

import { loadExportedDataset, type ExportedAgentExpected, type ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import { PrefixSeedingFailure, seededPrefixLifecycle } from "../src/prefix-seeding-lifecycle.ts";
import { UnreadableSeededPendingError } from "../src/trajectory-prefix-case.ts";
import { SeededSessions } from "../src/seeded-sessions.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import type { TurnDoor } from "../src/staging-turn-task.ts";
import { fakePrefixDoor, type PrefixDoorCall } from "./fake-prefix-door.ts";

type ExportedCase = Case<ExportedAgentInput, null, ExportedAgentExpected>;

const BEARER = new StagingBearer(() => Promise.resolve("qa-token"), () => 0);

/** Every case of one exported set, as the driver holds them. */
async function casesOf(setName: string): Promise<ExportedCase[]> {
  const dataset = await loadExportedDataset(setName);
  return dataset.cases;
}

/** Run `setup()` for every case of a set against one door, as the driver does. */
async function setupEvery(cases: readonly ExportedCase[], door: TurnDoor, sessions = new SeededSessions()): Promise<void> {
  const Lifecycle = seededPrefixLifecycle<null>({
    door, bearer: BEARER, sessions, sessionId: () => "session-seeded",
  });
  for (const one of cases) await new Lifecycle(one).setup?.();
}

/** The first case of one set — the one a body-shape assertion reads. */
async function firstCaseOf(setName: string): Promise<ExportedCase> {
  const [first] = await casesOf(setName);
  assert.ok(first !== undefined, `${setName} carries at least one case`);
  return first;
}

function seedingBodies(calls: readonly PrefixDoorCall[]): unknown[] {
  return calls.map((call) => JSON.parse(call.body) as unknown);
}

void test("every phase1c_selection_v1 case is seeded, once each", async () => {
  const cases = await casesOf("phase1c_selection_v1");
  const door = fakePrefixDoor();

  await setupEvery(cases, door.door);

  assert.equal(cases.length, 5);
  assert.equal(door.calls.length, 5);
});

void test("a set with no seeded_pending reaches the door zero times", async () => {
  const door = fakePrefixDoor();

  await setupEvery(await casesOf("agent_eval_heldout_v1"), door.door);

  assert.deepEqual(door.calls, []);
});

void test("the seeding is posted to the named session's own path with the bearer", async () => {
  const door = fakePrefixDoor();

  await setupEvery(await casesOf("phase1c_selection_v1"), door.door);

  const call = door.calls.at(0);
  assert.ok(call !== undefined, "one seeding was made");
  assert.equal(call.path, "/v1/staging/sessions/session-seeded/prefix");
  assert.equal(call.headers.get("Authorization"), "Bearer qa-token");
});

void test("every seeded body is one the contract accepts", async () => {
  const door = fakePrefixDoor();

  await setupEvery(await casesOf("phase1c_selection_v1"), door.door);

  const refused = seedingBodies(door.calls).filter((body) => !SeedTrajectoryPrefixRequest.safeParse(body).success);
  assert.deepEqual(refused, []);
});

void test("the seeded question carries the case's own clarification id and its ordered candidates", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const door = fakePrefixDoor();

  await setupEvery([first], door.door);

  const { pending_clarification: asked } = SeedTrajectoryPrefixRequest.parse(seedingBodies(door.calls).at(0));
  assert.ok(asked !== null, "the seeded turn left an open question");
  assert.equal(asked.id, first.inputs.clarification_id);
  assert.deepEqual(asked.candidates.map((candidate) => candidate.id), first.inputs.selected_candidate_ids);
});

void test("the case id is the dataset's own case name, so a re-run is the same seeding", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const door = fakePrefixDoor();

  await setupEvery([first], door.door);

  assert.equal(SeedTrajectoryPrefixRequest.parse(seedingBodies(door.calls).at(0)).case_id, first.name);
});

void test("a refused seeding fails the case loudly rather than running it unseeded", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const door = fakePrefixDoor({ status: 409, body: '{"error":{"code":"session_not_empty"}}' });

  await assert.rejects(
    setupEvery([first], door.door),
    (error: unknown) => error instanceof PrefixSeedingFailure && error.status === 409,
  );
});

void test("a seeded case's session is claimed for the task that must run on it", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const sessions = new SeededSessions();

  await setupEvery([first], fakePrefixDoor().door, sessions);

  assert.equal(sessions.of(first.inputs), "session-seeded");
});

void test("an unseeded case claims nothing, so its turns start from an empty session", async () => {
  const first = await firstCaseOf("agent_eval_heldout_v1");
  const sessions = new SeededSessions();

  await setupEvery([first], fakePrefixDoor().door, sessions);

  assert.equal(sessions.of(first.inputs), null);
});

/** One case whose `seeded_pending` a test replaces with what it is about. */
function caseWithSeed(inputs: ExportedAgentInput, seed: unknown): ExportedCase {
  return new Case({ name: "seed-shape", inputs: { ...inputs, seeded_pending: seed as null } });
}

void test("a case whose seeded_pending key is absent altogether needs no prefix", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const { seeded_pending: _omitted, ...withoutKey } = first.inputs;
  const door = fakePrefixDoor();

  await setupEvery([caseWithSeed(withoutKey as ExportedAgentInput, undefined)], door.door);

  assert.deepEqual(door.calls, []);
});

void test("an unreadable seeded_pending fails the case rather than running it unseeded", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const broken: readonly unknown[] = [
    "not-an-object",
    { reason: "unknown_ambiguity", revision: 1, candidates: [{ id: "a", title: "A" }] },
    { reason: "anime_ambiguity", revision: "1", candidates: [{ id: "a", title: "A" }] },
    { reason: "anime_ambiguity", revision: 1, candidates: [] },
    { reason: "anime_ambiguity", revision: 1, candidates: [{ title: "no id" }] },
    // Readable to the eye, refused by the edge's own schema — which is the
    // whole reason this module reads with that schema rather than beside it.
    { reason: "anime_ambiguity", revision: 0, candidates: [{ id: "a", title: "A" }] },
    { reason: "anime_ambiguity", revision: 1.5, candidates: [{ id: "a", title: "A" }] },
    { reason: "anime_ambiguity", revision: 1, candidates: [{ id: "a", title: "A", lat: "35.0" }] },
    { reason: "anime_ambiguity", revision: 1, candidates: [{ id: "a", title: "" }] },
  ];

  for (const seed of broken) {
    await assert.rejects(
      setupEvery([caseWithSeed(first.inputs, seed)], fakePrefixDoor().door),
      (error: unknown) => error instanceof UnreadableSeededPendingError,
    );
  }
});

void test("an unreadable seed names the member that could not be read", async () => {
  const first = await firstCaseOf("phase1c_selection_v1");
  const seed = (member: Record<string, unknown>): ExportedCase =>
    caseWithSeed(first.inputs, { reason: "anime_ambiguity", revision: 1, candidates: [{ id: "a", title: "A" }], ...member });

  await assert.rejects(
    setupEvery([seed({ revision: 0 })], fakePrefixDoor().door), /revision 0 is not a positive whole number/,
  );
  await assert.rejects(
    setupEvery([seed({ candidates: [{ id: "a", title: "A", lat: "35.0" }] })], fakePrefixDoor().door),
    /its candidate list is empty or carries a row the edge would refuse/,
  );
});
