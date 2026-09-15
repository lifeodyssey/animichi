import assert from "node:assert/strict";
import type { TestContext } from "node:test";

export function catalogClock(context: TestContext) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => { controller.abort(new DOMException("Request deadline expired", "TimeoutError")); }, milliseconds);
    return controller.signal;
  });
}

/** Captured before any test enables mocked timers, so the guard below stays on the real clock. */
const diagnosticTimeout = globalThis.setTimeout;

/**
 * Await the event a mocked-clock test asserts.
 *
 * A mocked clock never advances by itself, so a regression that makes the code under test wait for one
 * of those timers would otherwise hang the whole run without evidence. The guard turns that hang into a
 * named failure; it cannot race the healthy path, which settles in microtasks. Diagnostics only.
 */
export function settledWithin<T>(pending: Promise<T>, description: string): Promise<T> {
  const guard = new Promise<never>((_resolve, reject) => {
    diagnosticTimeout(() => { reject(new Error(`Timed out waiting for ${description}; the mocked clock was never advanced`)); }, 10_000).unref();
  });
  return Promise.race([pending, guard]);
}

export function pendingCatalog(attempts: number) {
  const received = Array.from({ length: attempts }, () => Promise.withResolvers<PendingAttempt>());
  const aborted = Array.from({ length: attempts }, () => Promise.withResolvers<undefined>());
  let index = 0;
  const fetch = (request: Request) => new Promise<Response>((resolve, reject) => {
    const attempt = index++;
    const next = received[attempt];
    const stopped = aborted[attempt];
    assert.ok(next && stopped, "The catalog must not make an extra attempt");
    request.signal.addEventListener("abort", () => { rejectAborted(request, stopped, reject); }, { once: true });
    next.resolve({ request, respond: resolve });
  });
  return { fetch, received: attemptAt(received), aborted: attemptAt(aborted) };
}

interface PendingAttempt { request: Request; respond: (response: Response) => void }

/** The transport's own abort event, so a test never samples a request signal after a guessed number of turns. */
function rejectAborted(request: Request, stopped: PromiseWithResolvers<undefined>, reject: (reason: unknown) => void) {
  stopped.resolve(undefined);
  const reason: unknown = request.signal.reason;
  assert.ok(reason instanceof Error);
  reject(reason);
}

function attemptAt<T>(attempts: PromiseWithResolvers<T>[]) {
  return (attempt: number) => { const next = attempts[attempt]; assert.ok(next); return next.promise; };
}
