/**
 * The pause a test hands the idempotent save in place of its real timer when
 * the in-flight wait is not the test's subject: it takes no time and records
 * nothing. Tests about the wait record their pauses instead
 * (saved-route-concurrent-save.integration.test.ts) or fake the timers
 * (idempotent-save-wait.worker.test.ts).
 */
export function instantPause(): Promise<void> {
  return Promise.resolve();
}
