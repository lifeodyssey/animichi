import { vi } from "vitest";

/**
 * `AbortSignal.timeout` rebuilt on vitest's fake timers. vitest fakes
 * `setTimeout`, not the platform's own timeout signal, so a test that mocks the
 * clock puts this in its place — the precedent is `packages/agent`'s
 * `test/catalog-clock.ts`. Returns the fake time at which each timeout was armed.
 */
export function abortTimeoutsOnFakeClock(): number[] {
  const armedAt: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    armedAt.push(Date.now());
    const controller = new AbortController();
    setTimeout(() => { controller.abort(new DOMException("The operation timed out.", "TimeoutError")); }, ms);
    return controller.signal;
  });
  return armedAt;
}
