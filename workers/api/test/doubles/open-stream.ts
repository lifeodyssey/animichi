/** A response body that has already delivered its first SSE frame and never
 * closes, plus the event that fires when something reads it (#1720).
 *
 * Two guards proved "the seam still has this body to hand back" by racing the
 * caller's fetch against a real one-second `setTimeout` and asserting the fetch
 * won. Under load a healthy fetch loses that race, so the guard reports a
 * defect where there is none — the flake class #1688 removed. Reading the body
 * is the state that timer was proxying for, and it is an event the subject
 * emits itself: `pull` runs once something pulls past the queued frame — a
 * read, and also a `tee` (`Response.clone()`) or a pipe, which pull eagerly.
 * A subject that decides on the status alone and hands the body back untouched
 * never fires it; one that awaits the body
 * (`await response.clone().text()`) always does — and then parks on a body that
 * never closes. That is the delivered event, with no clock in the race.
 */
export interface OpenStream {
  /** One queued SSE frame, delivered only once something reads the body. */
  readonly body: ReadableStream<Uint8Array>;
  /** Settles only on a read of `body`: the drain under test. */
  readonly bodyRead: Promise<null>;
  /** Close the body, so a subject parked on it can settle. */
  readonly release: () => void;
}

export function openStream(): OpenStream {
  const read = Promise.withResolvers<null>();
  let close: () => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      close = () => { controller.close(); };
    },
    pull() { read.resolve(null); },
  });
  return { body, bodyRead: read.promise, release: () => { close(); } };
}
