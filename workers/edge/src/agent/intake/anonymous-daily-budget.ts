/**
 * The shared anonymous daily dollar ceiling (#282 / #688), the budget the
 * admission reservation, the drive and every tool re-read through
 * `anonymousBudgetAvailable` (`agent/host/native-authority.ts`).
 *
 * The env-var semantics are unchanged and are the fallback the runtime knob
 * defers to (#688): an unset value defaults to 5 USD, and a malformed or
 * negative value throws — a typo in this ceiling must be loud, not silently
 * free or silently closed.
 */

/** How many dollars one UTC day of anonymous usage may spend; `undefined`
 * defaults to 5, and anything not finite and non-negative throws. */
export function anonymousDailyBudget(value: string | undefined): number {
  const budget = value === undefined ? 5 : Number(value);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Anonymous daily budget is invalid");
  return budget;
}
