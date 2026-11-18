/** Runtime behaviours question 1 records, measured inside workerd at the edge's compatibility settings. */

function newFunction(): { readonly allowed: boolean; readonly error?: string } {
  try {
    const built = new Function("return 1") as () => number;
    return { allowed: built() === 1 };
  } catch (error) {
    return { allowed: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** Evaluated when workerd loads the module, which is where a library's feature detection usually runs. */
const MODULE_SCOPE = { newFunction: newFunction(), abortSignalAny: typeof AbortSignal.any };

/** Count the turn's own `AbortSignal.any` calls (chord's `withAbortSignal`, pi-ai): the native method, wrapped. */
const ANY_CALLS = { calls: 0, patched: false };
try {
  const nativeAny = AbortSignal.any.bind(AbortSignal);
  Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true,
    value: (signals: Iterable<AbortSignal>) => { ANY_CALLS.calls += 1; return nativeAny(signals); } });
  ANY_CALLS.patched = true;
} catch {
  ANY_CALLS.patched = false;
}

function abortSignalAny() {
  const first = new AbortController();
  const second = new AbortController();
  const any = AbortSignal.any([first.signal, second.signal]);
  const before = any.aborted;
  second.abort(new Error("second aborted"));
  return { type: typeof AbortSignal.any, abortedBefore: before, abortedAfter: any.aborted,
    reason: any.reason instanceof Error ? any.reason.message : String(any.reason) };
}

function dateNowDuringSyncWork() {
  const start = Date.now();
  let spin = 0;
  for (let index = 0; index < 20_000_000; index += 1) spin = (spin + index) % 9_973;
  return { elapsedMs: Date.now() - start, spin };
}

async function setTimeoutElapsed(ms: number) {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { requestedMs: ms, elapsedMs: Date.now() - start };
}

export async function runtimeProbes() {
  const callsBeforeProbe = { ...ANY_CALLS };
  const composed = abortSignalAny();
  // Positive control: the probe's own single `AbortSignal.any` call must move the counter by exactly one.
  const callsAfterProbe = { ...ANY_CALLS };
  return { moduleScope: MODULE_SCOPE, handler: { newFunction: newFunction() }, abortSignalAnyCallsSinceLoad: callsBeforeProbe,
    abortSignalAnyCallsAfterOwnCall: callsAfterProbe, abortSignalAny: composed,
    dateNowDuringSyncWork: dateNowDuringSyncWork(), setTimeout: await setTimeoutElapsed(25) };
}
