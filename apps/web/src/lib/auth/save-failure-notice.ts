/**
 * One-time notice that the post-login create-on-login replay failed while the
 * visitor was being returned to a deep link (#482 residual 2). The auth
 * callback arms it just before it navigates; the destination consumes it on
 * mount, and consuming clears it, so a reload cannot resurrect the message.
 *
 * `sessionStorage`, not `localStorage`: a flash is tab-scoped and must not
 * outlive the tab, and the callback → target hop is same-tab. That is the
 * opposite of the deferred-save intent, whose magic link opens a fresh tab and
 * therefore needs origin-scoped storage.
 */

/** Namespaced key: one origin, one versioned notice slot. */
export const SAVE_FAILURE_NOTICE_KEY = "animichi.auth.saveFailureNotice.v1";

/** Storage can be absent (SSR) or throw a `SecurityError`; either way the
 * notice is best-effort and its absence must not break the page. */
function withStore<Result>(operation: (storage: Storage) => Result): Result | undefined {
  try {
    return operation(globalThis.sessionStorage);
  } catch {
    return undefined;
  }
}

/** Arm the notice for the next destination mount. */
export function armSaveFailureNotice(): void {
  withStore((storage) => {
    storage.setItem(SAVE_FAILURE_NOTICE_KEY, "1");
  });
}

/** Consume the notice — `true` at most once per arm, and never after a reload. */
export function consumeSaveFailureNotice(): boolean {
  return withStore((storage) => {
    const armed = storage.getItem(SAVE_FAILURE_NOTICE_KEY) !== null;
    storage.removeItem(SAVE_FAILURE_NOTICE_KEY);
    return armed;
  }) ?? false;
}
