/**
 * The recovery cadence a case in this lane opts into (issue #1731).
 *
 * Every host here arms production's 30 s recurring scan (`src/agent/host/wake-interval.ts`) unless
 * the case passes `FAST_RECOVERY_SCAN` as a binding. Only a case whose proof is that the recurring
 * scan itself recovers work passes it: inheriting 30 s would spend half a minute of wall clock per
 * assertion. A case about admission, interleaving, exclusivity or recovery ordering keeps the
 * production cadence, because an extra scan tick can drive its operation inside a window that case
 * assumes quiet. 2 s keeps every wait event-bound while leaving a stray tick unlikely in a case that
 * settles in about a second.
 */
export const FAST_RECOVERY_SCAN = { TEST_WAKE_INTERVAL_MS: "2000" };

/** The cadence a host arms: the case's opted-in interval, or the production one it inherits. */
export function recoveryScanInterval(env: Record<string, unknown>, production: number) {
  const configured = env.TEST_WAKE_INTERVAL_MS;
  return configured === undefined ? production : Number(configured);
}
