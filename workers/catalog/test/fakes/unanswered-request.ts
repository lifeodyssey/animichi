/**
 * A request that never answers, behaving as `fetch` does under its signal: it
 * rejects with the signal's own reason once the signal aborts, and at once if
 * it already has. Tests hold an upstream call open with this and then assert
 * which signal ended it.
 */
export function unanswered<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal.addEventListener("abort", () => { reject(abortReason(signal)); }, { once: true });
    signal.throwIfAborted();
  });
}

/** The signal's reason as the Error it is here: a DOMException, or the caller's own Error. */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason));
}
