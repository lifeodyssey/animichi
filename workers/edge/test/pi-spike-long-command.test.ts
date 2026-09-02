import test from "node:test";
import assert from "node:assert/strict";
import {
  ALARM_WALL_CLOCK_LIMIT_MS,
  DEFAULT_TOOL_CALLS,
  DEFAULT_TITLE,
  SPIKE_MIN_DEADLINE_MS,
  parseLongTurnCommand,
} from "../spike/pi/src/long-turn-command.ts";
import { routeOf, runIdOf } from "../spike/pi/src/spike-routes.ts";

// W0-S4 (#1247): the long turn's request surface. Two things are load-bearing
// here and nowhere else. The whole-turn deadline has NO default — spec §四 S4
// gives the spike its own budget of at least six minutes and says it must never
// become a production value, so a request that omits it is rejected rather than
// defaulted. And `GET /runs/:id` is the route the client uses after it hung up,
// so it must match run ids and nothing else.
//
// test-type: unit (pure functions; no bindings, no clock, no database).

const VALID = { deadlineMs: SPIKE_MIN_DEADLINE_MS, holdMs: 1_000 };
const RUN_ID = "0199a0b1-c2d3-7e4f-8a9b-0c1d2e3f4a5b";

void test("a long turn must name its own deadline; there is no default", () => {
  assert.equal(parseLongTurnCommand({ holdMs: 1_000 }).ok, false);
});

void test("the deadline floor is the spike-only six minutes of spec S4", () => {
  const tooShort = parseLongTurnCommand({ ...VALID, deadlineMs: SPIKE_MIN_DEADLINE_MS - 1 });
  assert.equal(tooShort.ok, false);
  assert.equal(parseLongTurnCommand(VALID).ok, true);
});

void test("the deadline may not outlast the alarm handler's own wall clock", () => {
  const tooLong = { ...VALID, deadlineMs: ALARM_WALL_CLOCK_LIMIT_MS + 1 };
  assert.equal(parseLongTurnCommand(tooLong).ok, false);
});

void test("a turn defaults to the three tool calls the hard condition names", () => {
  const parsed = parseLongTurnCommand(VALID);
  assert.equal(parsed.ok && parsed.command.toolCalls, DEFAULT_TOOL_CALLS);
  assert.equal(parsed.ok && parsed.command.title, DEFAULT_TITLE);
});

void test("holds that do not fit inside the deadline are rejected", () => {
  const parsed = parseLongTurnCommand({ ...VALID, holdMs: SPIKE_MIN_DEADLINE_MS / 2 });
  assert.equal(parsed.ok, false);
});

void test("the fault injectors must name a step of this turn", () => {
  assert.equal(parseLongTurnCommand({ ...VALID, crashBeforePersistStep: 3 }).ok, false);
  assert.equal(parseLongTurnCommand({ ...VALID, failAtStep: -1 }).ok, false);
  assert.equal(parseLongTurnCommand({ ...VALID, crashBeforePersistStep: 2 }).ok, true);
});

void test("absent fault injectors leave a plain turn", () => {
  const parsed = parseLongTurnCommand(VALID);
  assert.equal(parsed.ok && parsed.command.crashBeforePersistStep, null);
  assert.equal(parsed.ok && parsed.command.failAtStep, null);
});

void test("a non-object body is rejected rather than defaulted", () => {
  assert.equal(parseLongTurnCommand("long").ok, false);
  assert.equal(parseLongTurnCommand([SPIKE_MIN_DEADLINE_MS]).ok, false);
});

void test("the S4 routes join the S1 ones without disturbing them", () => {
  assert.equal(routeOf("POST", "/turn/long"), "turn_long");
  assert.equal(routeOf("GET", `/runs/${RUN_ID}`), "run_status");
  assert.equal(routeOf("POST", "/turn"), "turn");
  assert.equal(routeOf("POST", "/turn/abort"), "turn_abort");
  assert.equal(routeOf("GET", "/healthz"), "healthz");
});

void test("only a run-id shaped GET path is the status route", () => {
  assert.equal(routeOf("GET", "/runs/"), "not_found");
  assert.equal(routeOf("GET", "/runs/latest"), "not_found");
  assert.equal(routeOf("GET", "/turn"), "not_found");
  assert.equal(routeOf("POST", `/runs/${RUN_ID}`), "not_found");
});

void test("the status route hands the run id back to the caller", () => {
  assert.equal(runIdOf(`/runs/${RUN_ID}`), RUN_ID);
  assert.equal(runIdOf("/runs/nope"), null);
});
