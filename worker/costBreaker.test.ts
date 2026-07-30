import test from "node:test";
import assert from "node:assert/strict";
import {
  ANON_BUDGET_EXHAUSTED_CODE,
  budgetGuidanceResponse,
  isBudgetRejection,
  isLatched,
  parseBudgetLatch,
  readBudgetLatch,
  utcDayKey,
  writeBudgetLatch,
} from "./costBreaker.ts";
import { handleGuardRequest } from "./edgeGuard.ts";
import { memoryGuardStore } from "./guardStore.ts";

// Day rollover is exercised on an injected clock — never a real wait.
const DAY_ONE_MS = Date.UTC(2026, 6, 26, 23, 59, 0);
const DAY_TWO_MS = Date.UTC(2026, 6, 27, 0, 1, 0);
const FALLBACK = { limit: 20, windowSeconds: 60 };

const containerRejection = () =>
  new Response(JSON.stringify({ error: { code: ANON_BUDGET_EXHAUSTED_CODE } }), { status: 403 });

void test("the UTC calendar day is the breaker's reset boundary", () => {
  assert.equal(utcDayKey(DAY_ONE_MS), "2026-07-26");
  assert.equal(utcDayKey(DAY_TWO_MS), "2026-07-27");
});

void test("the container's breaker rejection is recognised by its error code", async () => {
  const response = containerRejection();
  assert.equal(isBudgetRejection(response.status, await response.text()), true);
});

void test("an unrelated 403 is not mistaken for a budget rejection", () => {
  assert.equal(isBudgetRejection(403, JSON.stringify({ error: { code: "forbidden" } })), false);
});

void test("a non-403 carrying the code is not a budget rejection", () => {
  assert.equal(isBudgetRejection(200, `{"error":{"code":"${ANON_BUDGET_EXHAUSTED_CODE}"}}`), false);
});

void test("the guidance response is a 403 that points the visitor at login", async () => {
  const response = budgetGuidanceResponse();
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { code: string; action: string; message: string } };
  assert.equal(body.error.code, ANON_BUDGET_EXHAUSTED_CODE);
  assert.equal(body.error.action, "login");
  assert.match(body.error.message, /ログイン/);
});

void test("a latch only suppresses the day it was written for", () => {
  assert.equal(isLatched({ dayKey: "2026-07-26" }, "2026-07-26"), true);
  assert.equal(isLatched({ dayKey: "2026-07-26" }, "2026-07-27"), false);
  assert.equal(isLatched(null, "2026-07-26"), false);
});

void test("a corrupt stored latch reads as not latched", () => {
  assert.equal(parseBudgetLatch({ dayKey: 7 }), null);
  assert.equal(parseBudgetLatch(null), null);
  assert.deepEqual(parseBudgetLatch({ dayKey: "d" }), { dayKey: "d" });
});

void test("the latch survives within the day and self-expires at rollover", async () => {
  const store = memoryGuardStore();
  await writeBudgetLatch(store, utcDayKey(DAY_ONE_MS));
  assert.equal(await readBudgetLatch(store, utcDayKey(DAY_ONE_MS)), true);
  assert.equal(await readBudgetLatch(store, utcDayKey(DAY_TWO_MS)), false);
});

async function guardBudget(store: ReturnType<typeof memoryGuardStore>, method: string, nowMs: number) {
  const url = `https://edge-guard/budget?dayKey=${utcDayKey(nowMs)}`;
  const response = await handleGuardRequest(new Request(url, { method }), store, nowMs, FALLBACK);
  return await response.json();
}

void test("the guard shard reports the latch it was told to set", async () => {
  const store = memoryGuardStore();
  assert.equal((await guardBudget(store, "GET", DAY_ONE_MS)).latched, false);
  assert.equal((await guardBudget(store, "POST", DAY_ONE_MS)).latched, true);
  assert.equal((await guardBudget(store, "GET", DAY_ONE_MS)).latched, true);
});

void test("the guard shard clears the latch on the next UTC day", async () => {
  const store = memoryGuardStore();
  await guardBudget(store, "POST", DAY_ONE_MS);
  assert.equal((await guardBudget(store, "GET", DAY_TWO_MS)).latched, false);
});

void test("the guard shard rejects an unknown path", async () => {
  const response = await handleGuardRequest(
    new Request("https://edge-guard/nope"), memoryGuardStore(), DAY_ONE_MS, FALLBACK,
  );
  assert.equal(response.status, 404);
});

void test("the guard shard applies the request's limiter config", async () => {
  const store = memoryGuardStore();
  const call = () =>
    handleGuardRequest(
      new Request("https://edge-guard/rate-limit", {
        method: "POST",
        body: JSON.stringify({ limit: 1, windowSeconds: 60 }),
      }),
      store, DAY_ONE_MS, FALLBACK,
    );
  assert.deepEqual(await (await call()).json(), { allowed: true, retryAfterSeconds: 60 });
  assert.deepEqual(await (await call()).json(), { allowed: false, retryAfterSeconds: 60 });
});
