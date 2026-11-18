import { redactedCause } from "./redacted-cause";

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

/**
 * One sub-step's failure, attributed (#1915): the stable `migration_unavailable` code says the
 * apply threw, and the message prefix says WHERE. The prefix is composed after `redactedCause`
 * because a driver message can carry the DSN's password; the prefixed line is what both the
 * one log line and the route's `cause` field carry.
 *
 * The entry line comes first (#1958), so a sub-step that only goes quiet names itself too: a
 * slow call throws nothing for this prefix to carry.
 *
 * Here, not in the apply path, because the provisioning step's login probes name themselves
 * with it too (#1958): `service-roles.ts` wraps each probe, so a deadline abort leaves it as
 * `authenticates <role>: …` instead of being re-read as a stale password.
 */
export async function named<T>(step: string, work: () => T | Promise<T>): Promise<T> {
  logStepEntry(step);
  return await attributed(step, work);
}

/**
 * The attribution half of `named`, without its entry line (#1958). The provisioning step logs
 * its entry before its login probes start, then names the batch it runs at the end with this,
 * so a batch that goes quiet leaves as `provisionServiceRoles: …` without a second entry line
 * for one step.
 */
export async function attributed<T>(step: string, work: () => T | Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw new Error(`${step}: ${redactedCause(error)}`, { cause: error }); }
}
