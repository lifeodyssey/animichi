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

/**
 * The SDK retry delay every business host in this lane arms (issue #1782): how long a waiting
 * operation's deadline wake stays pending. Nothing here can advance that wait. Miniflare exposes no
 * clock or alarm control, the SDK's alarm drives only rows with `time <= Date.now()`, and pi
 * re-checks `Date.now() < notBefore` before it retries — so the retry case waits it out for real.
 *
 * It only has to outlast what a case observes while the retry is pending. From the failed request
 * to the last in-window assertion took 25 / 30 / 38 ms (`recovery-endings.test.ts`) and
 * 25 / 31 / 20 ms (`native-host.test.ts`) over three full lane runs at load 2.9, against emulated
 * Postgres. 5 s is over 100 times the slowest of those. No assertion reads the value itself: each
 * compares the armed wake with the SDK's own `notBefore`.
 */
export const RETRY_DELAY_MS = 5_000;

/** The cadence a host arms: the case's opted-in interval, or the production one it inherits. */
export function recoveryScanInterval(env: Record<string, unknown>, production: number) {
  const configured = env.TEST_WAKE_INTERVAL_MS;
  return configured === undefined ? production : Number(configured);
}
