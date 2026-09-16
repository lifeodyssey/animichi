import assert from "node:assert/strict";
import type { TestContext } from "node:test";
/** A real event-loop turn: the promises API draws from the timers module, not from the globals a test mocks. */
import { setImmediate as realEventLoopTurn } from "node:timers/promises";

export function catalogClock(context: TestContext) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => { controller.abort(new DOMException("Request deadline expired", "TimeoutError")); }, milliseconds);
    return controller.signal;
  });
}

/** The runner backstop the guarded lanes declare. The guard below reports a frozen mocked clock long before it. */
export const GUARDED_TEST_TIMEOUT_MS = 120_000;

/**
 * Force a scavenge, so a chain that is only weakly reachable is actually collected.
 *
 * `AbortSignal.any` holds its sources weakly, which is what the catalog client's request anchor compensates
 * for. A lane can only observe that under `--expose-gc`, which the package test script passes.
 */
export function scavenge() {
  (globalThis as { gc: () => void }).gc();
}

/**
 * Real event-loop turns a guarded event may outlive before the guard names the state the wait is stuck in.
 *
 * The unit is the point. Node's mock timers expose `tick`, `setTime`, `runAll` and `reset` but no way to ask
 * whether anything is still pending, and a trip condition derived from the host (elapsed time, load average)
 * also moves on a healthy run. Turns are the one budget a busy host cannot spend: they count work the event
 * needed, they do not accrue while the process is starved, and a mocked timer cannot fire on any number of
 * them. Both guarded events settle within a handful of turns, so this is slack, not a tight judgement.
 */
const GUARDED_TURNS = 1_000;

/**
 * Await the event a mocked-clock test asserts, and fail loud when only a tick the test never performed could
 * still produce it.
 *
 * Only the test can advance the mocked clock, so a regression that parks the code under test on one of those
 * timers leaves the event unreachable however long the host waits. Elapsed time cannot tell that state from a
 * healthy event that merely needed a core: round 1 named a 100-second margin and it fired under load while
 * these lanes settle in about a second of work. Turns separate the two states, and because nothing can tick
 * the mocked clock while this call is awaited, running out of turns means no future turn can either.
 */
export function settledWithin<T>(pending: Promise<T>, description: string, turns = GUARDED_TURNS): Promise<T> {
  let arrived = false;
  const arrival = pending.then((value) => { arrived = true; return value; }, (error: unknown) => { arrived = true; throw error; });
  return Promise.race([arrival, stalledWithin(() => arrived, turns, description)]);
}

async function stalledWithin(arrived: () => boolean, turns: number, description: string): Promise<never> {
  for (let turn = 0; turn < turns; turn++) {
    if (arrived()) return stillWaiting;
    await realEventLoopTurn();
  }
  throw new Error(hangDiagnostic(description, turns));
}

/** The arrival already won the race; the guard arm holds the race open without ever settling it itself. */
const stillWaiting = new Promise<never>(() => undefined);

function hangDiagnostic(description: string, turns: number) {
  return `Waited ${String(turns)} real event-loop turns for ${description} while the mocked clock stayed unadvanced; no turn can fire a mocked timer until the test ticks it`;
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
