/**
 * #1958 — one line per sub-step, emitted when the sub-step STARTS.
 *
 * #1955's `named(step, work)` prefixes a failure with the sub-step that THREW, and that is all
 * it can do for a call that only stops answering: a slow call never throws, so nothing was
 * logged, and CD's 2026-09-24 preflight (run 35994030049) timed out with an empty log. This is
 * the line that says which step the migrator was in when it went quiet.
 *
 * `console.log`, not `console.error`: the error channel is the one the refusal paths keep clean
 * of driver detail on purpose (`test/preflight.worker.failures.test.ts`), and this line is
 * meant to reach Workers Logs. A step name carries no DSN and no password —
 * `test/apply-step-log.test.ts` pins that in both directions.
 */
export function logStepEntry(step: string): void {
  console.log(`[migrator] step: ${step}`);
}
