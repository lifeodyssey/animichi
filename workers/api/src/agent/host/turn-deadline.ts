/**
 * The whole-turn budget (issue #1416, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二/§四): one turn gets
 * `TURN_DEADLINE_MS` from the moment the native lane accepts it, and the budget
 * is never renewed. The retired run engine carried the same 100 s product
 * decision on `runs.deadline_at` (`intake/turn-intake.ts`, deleted with the
 * run engine in #1582); the native tier enforces it against the SDK's own
 * durable acceptance witness, `CurrentOperationInfo.startedAt`.
 *
 * The deadline is not a client disconnect: the turn belongs to the session, not
 * to the connection, so only the budget and an explicit refusal end it.
 */
export const TURN_DEADLINE_MS = 100_000;

/** One live drive's non-renewable turn budget; the durable witness is what survives eviction, not this. */
export interface TurnWindow { readonly operationId: string; readonly deadlineAt: number }

/** One operation's non-renewable deadline, derived from its durable acceptance time. */
export function turnDeadline(startedAt: number, budgetMs: number): number {
  return startedAt + budgetMs;
}

/** The milliseconds still available to the next model-request boundary; 0 means the budget is spent. */
export function remainingTurnBudget(deadlineAt: number, now: number): number {
  return Math.max(0, deadlineAt - now);
}
