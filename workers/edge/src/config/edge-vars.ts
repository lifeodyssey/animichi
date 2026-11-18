/**
 * The edge Worker's runtime-tunable knob registry (issue #688). Every entry is
 * built through `runtimeKnob`, which refuses any var `edge-var-inventory.ts`
 * classifies as deploy-coupled.
 */

import { anonymousDailyBudget } from "../agent/intake/anonymous-daily-budget.ts";
import { anonymousMessageAllowance } from "../agent/intake/anonymous-message-allowance.ts";
import { createKnobReader, runtimeKnob, type KnobReader, type RuntimeKnob } from "./runtime-knobs.ts";

/** The store keys and env fallbacks of every runtime-tunable var. Built through
 * `runtimeKnob`, so a deploy-coupled name can never enter this registry. */
export const RUNTIME_KNOBS = {
  anonymousDailyCostBudgetUsd: runtimeKnob<number>({
    envVar: "ANON_DAILY_COST_BUDGET_USD",
    kvKey: "knob:anon_daily_cost_budget_usd",
    parse: parseNonNegativeNumber,
    fromEnv: anonymousDailyBudget,
  }),
  anonymousDailyMessageQuota: runtimeKnob<number>({
    envVar: "ANON_DAILY_MESSAGE_QUOTA",
    kvKey: "knob:anon_daily_message_quota",
    parse: parseNonNegativeInteger,
    fromEnv: anonymousMessageAllowance,
  }),
} as const satisfies Record<string, RuntimeKnob<number>>;

/** The isolate-wide reader production uses; one cache per isolate. */
export const edgeKnobs: KnobReader = createKnobReader({ now: Date.now });

function parseNonNegativeNumber(raw: string): number | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseNonNegativeInteger(raw: string): number | undefined {
  const parsed = parseNonNegativeNumber(raw);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined;
}
