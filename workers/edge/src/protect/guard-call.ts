/// <reference types="@cloudflare/workers-types" />

/**
 * One bounded call to a guard Durable Object (EG-21, issue #1343; 08-26 §3).
 *
 * The limiter's shard call had a `try`/`catch` and the budget latch's had
 * nothing, and neither had a deadline — so a hung shard held every fail-closed
 * `/v1/chat` open indefinitely instead of answering the 503 the policy designs
 * for it, while `/v1`'s own downstream hop had been bounded since #1220 (the
 * container fetch that motivated that bound was deleted in #1605).
 */

/** A guard shard narrowed to the single call the guards make. */
export interface GuardShard {
  fetch(request: Request): Promise<Response>;
}

/**
 * How long a shard has to answer. A guard check is one single-key transaction
 * on one object, so this is orders of magnitude above a healthy round trip —
 * and well below the 60s bound the deleted container forward used to put on the
 * `/v1` work behind it, which a gate in FRONT of that work must never outlive.
 */
export const GUARD_CALL_TIMEOUT_MS = 5_000;

/**
 * Ask a guard shard, or give up. Returns the shard's response, or null when the
 * call failed or ran out of time — "no answer in time" is the SAME no-verdict
 * every caller already maps onto its own policy (fail CLOSED for the durable
 * classes, #680 AC4; fail open for the budget latch, whose authority is the
 * ingress's own accounting anyway).
 *
 * The deadline both rides the request — so the shard's own work is cancelled
 * rather than left running — and is raced here, so this call is bounded even if
 * the object on the other side never observes the signal. Unlike the deleted
 * container fetch, whose signal was deliberately disarmed once the response head
 * landed because it would otherwise cut a live SSE body, a guard answers with
 * one small JSON body and has no stream to protect.
 *
 * The timer is a plain `setTimeout` because it is a hard outer bound, not a
 * pacing knob, so it is neither a caller's parameter nor an injectable `sleep`
 * (which the container cold-start retry used and #1605 deleted with it) — and a
 * test drives it on `mock.timers` rather than on the wall clock.
 */
export async function guardCall(shard: GuardShard, request: Request): Promise<Response | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => { deadline.abort(); }, GUARD_CALL_TIMEOUT_MS);
  try {
    return await Promise.race([shard.fetch(new Request(request, { signal: deadline.signal })), expired(deadline.signal)]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rejects when the deadline fires. `Promise.race` subscribes to both inputs,
 * so whichever one loses can still settle without going unhandled. */
function expired(deadline: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    deadline.addEventListener("abort", () => { reject(new Error("guard call deadline")); }, { once: true });
  });
}
