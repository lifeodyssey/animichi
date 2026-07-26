/// <reference types="@cloudflare/workers-types" />

import type { GuardNamespace, GuardStore } from "./guardStore.ts";

/**
 * Global anonymous daily-budget circuit breaker (X4, issue #274 / S1.8).
 *
 * The AUTHORITATIVE decision lives in the container ingress, which is the only
 * tier that reads the `daily_usage` table (SD-18). This edge module owns the
 * breaker's *wire contract* and a same-day latch: once the container has
 * reported the budget exhausted, the edge short-circuits subsequent anonymous
 * `/v1/chat` requests for the rest of the UTC day instead of paying for a
 * container round-trip per rejected visitor. Logged-in traffic never reaches
 * this path.
 */
export const ANON_BUDGET_EXHAUSTED_CODE = "anon_budget_exhausted";

const LATCH_KEY = "budget-latch";
const GUIDANCE_MESSAGE =
  "今日はここまで。ログインすると続きから一緒に旅の計画を立てられるよ。";

export interface BudgetLatch {
  readonly dayKey: string;
}

/** UTC calendar day, the reset boundary the daily budget is defined against. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function parseBudgetLatch(value: unknown): BudgetLatch | null {
  if (typeof value !== "object" || value === null) return null;
  const { dayKey } = value as Partial<BudgetLatch>;
  return typeof dayKey === "string" ? { dayKey } : null;
}

/** A latch only suppresses traffic for the day it was set — it self-expires. */
export function isLatched(latch: BudgetLatch | null, dayKey: string): boolean {
  return latch !== null && latch.dayKey === dayKey;
}

export async function readBudgetLatch(store: GuardStore, dayKey: string): Promise<boolean> {
  return isLatched(parseBudgetLatch(await store.get(LATCH_KEY)), dayKey);
}

export async function writeBudgetLatch(store: GuardStore, dayKey: string): Promise<void> {
  await store.put(LATCH_KEY, { dayKey });
}

/** Recognise the container ingress's breaker rejection by its error code. */
export function isBudgetRejection(status: number, body: string): boolean {
  if (status !== 403) return false;
  return body.includes(`"${ANON_BUDGET_EXHAUSTED_CODE}"`);
}

/**
 * The single rejection shape anonymous callers see, whether the verdict came
 * from the container or from the edge latch. 403 guides the client to log in
 * (the web client classifies 401/403 as its login-recovery state).
 */
export function budgetGuidanceResponse(): Response {
  const body = {
    error: { code: ANON_BUDGET_EXHAUSTED_CODE, message: GUIDANCE_MESSAGE, action: "login" },
  };
  return new Response(JSON.stringify(body), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function budgetShard(guard: GuardNamespace): { fetch: (r: Request) => Promise<Response> } {
  return guard.get(guard.idFromName("budget"));
}

async function callBudget(guard: GuardNamespace, method: string, dayKey: string): Promise<boolean> {
  const url = `https://edge-guard/budget?dayKey=${encodeURIComponent(dayKey)}`;
  const response = await budgetShard(guard).fetch(new Request(url, { method }));
  if (!response.ok) return false;
  const parsed: unknown = await response.json();
  return typeof parsed === "object" && parsed !== null && (parsed as { latched?: unknown }).latched === true;
}

/** True when the breaker already tripped today (edge-cached container verdict). */
export function budgetLatched(guard: GuardNamespace, dayKey: string): Promise<boolean> {
  return callBudget(guard, "GET", dayKey);
}

/** Record today's container verdict so the edge can short-circuit from now on. */
export async function latchBudget(guard: GuardNamespace, dayKey: string): Promise<void> {
  await callBudget(guard, "POST", dayKey);
}
