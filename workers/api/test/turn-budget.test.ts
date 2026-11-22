import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { AdmissionDatabase } from "../src/agent/admission/types.ts";
import { TurnBudget, type TurnLane } from "../src/agent/host/turn-budget.ts";

/** 2026-09-17T12:00:00Z; every case drives the mocked clock from this instant. */
const ACCEPTED_AT = Date.UTC(2026, 8, 17, 12, 0, 0);
const TURN_BUDGET_MS = 100_000;

/** The lane surface one turn's budget reads, recording the cancellation it requests in `order`. */
function budgetLane(current: { id: string; startedAt: number } | null, order: string[], abort: "granted" | "refused" = "granted"): TurnLane {
  return {
    inspectExecution: () => Promise.resolve({ current }),
    requestAbort: () => {
      order.push("abort");
      return Promise.resolve(abort === "granted" ? { ok: true } : { ok: false, error: new Error("Injected lane close") });
    },
  };
}

/** A business database whose deadline write never observes a commit, as a refused lock or an outage would. */
function deadlineAdmission(order: string[], write: "refused" | "rejected"): AdmissionDatabase {
  return { transaction: () => {
    order.push("persist");
    return write === "rejected" ? Promise.reject(new Error("Injected rejection outage")) : Promise.resolve(false);
  } } as unknown as AdmissionDatabase;
}

void test("the turn budget opens from the lane's durable acceptance witness, not the request clock", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT + 30_000 });
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, []);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS);

  await budget.open(lane, "op", BACKGROUND_CONTEXT);

  assert.deepEqual(await budget.boundModelRequest(lane, { streamOptions: {} }, BACKGROUND_CONTEXT), { streamOptions: { timeoutMs: 70_000 } });
});

void test("a spent turn budget commits the deadline rejection before it aborts the lane", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT + TURN_BUDGET_MS });
  const order: string[] = [];
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, order);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS, deadlineAdmission(order, "refused"));

  await budget.open(lane, "op", BACKGROUND_CONTEXT);

  assert.deepEqual(order, ["persist", "abort"]);
});

void test("a request that arrives after the budget is spent is withheld while the turn ends", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT });
  const order: string[] = [];
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, order);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS, deadlineAdmission(order, "refused"));

  await budget.open(lane, "op", BACKGROUND_CONTEXT);
  context.mock.timers.tick(TURN_BUDGET_MS);

  assert.equal(await budget.boundModelRequest(lane, { streamOptions: {} }, BACKGROUND_CONTEXT), undefined);
  assert.deepEqual(order, ["persist", "abort"]);
});

void test("a deadline write that rejects still aborts the lane, and keeps its own error", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT + TURN_BUDGET_MS });
  const order: string[] = [];
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, order);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS, deadlineAdmission(order, "rejected"));

  await assert.rejects(budget.open(lane, "op", BACKGROUND_CONTEXT), /Injected rejection outage/);

  assert.deepEqual(order, ["persist", "abort"]);
});

void test("the turn budget stays closed for an operation the lane does not own", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT });
  const lane = budgetLane({ id: "another-operation", startedAt: ACCEPTED_AT }, []);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS);

  await budget.open(lane, "op", BACKGROUND_CONTEXT);

  assert.equal(await budget.boundModelRequest(lane, { streamOptions: {} }, BACKGROUND_CONTEXT), undefined);
});

void test("the turn budget stays closed while the lane has no current operation", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT });
  const lane = budgetLane(null, []);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS);

  await budget.open(lane, "op", BACKGROUND_CONTEXT);

  assert.equal(await budget.boundModelRequest(lane, { streamOptions: {} }, BACKGROUND_CONTEXT), undefined);
});

void test("a model request is clamped to the budget that remains, never extended past it", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT });
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, []);
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS);
  await budget.open(lane, "op", BACKGROUND_CONTEXT);
  context.mock.timers.tick(30_000);

  assert.deepEqual(await budget.boundModelRequest(lane, { streamOptions: { timeoutMs: 90_000 } }, BACKGROUND_CONTEXT), { streamOptions: { timeoutMs: 70_000 } });
  assert.deepEqual(await budget.boundModelRequest(lane, { streamOptions: { timeoutMs: 5_000 } }, BACKGROUND_CONTEXT), { streamOptions: { timeoutMs: 5_000 } });
});

void test("a refused deadline write that cannot stop the turn rethrows the refused abort", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT + TURN_BUDGET_MS });
  const order: string[] = [];
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, order, "refused");
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS, deadlineAdmission(order, "refused"));

  await assert.rejects(budget.open(lane, "op", BACKGROUND_CONTEXT), /Injected lane close/);

  assert.deepEqual(order, ["persist", "abort"]);
});

void test("a refused abort stays behind the rejected deadline write that already ended the turn", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: ACCEPTED_AT + TURN_BUDGET_MS });
  const order: string[] = [];
  const lane = budgetLane({ id: "op", startedAt: ACCEPTED_AT }, order, "refused");
  const budget = new TurnBudget("session-budget", TURN_BUDGET_MS, deadlineAdmission(order, "rejected"));

  await assert.rejects(budget.open(lane, "op", BACKGROUND_CONTEXT), /Injected rejection outage/);

  assert.deepEqual(order, ["persist", "abort"]);
});
