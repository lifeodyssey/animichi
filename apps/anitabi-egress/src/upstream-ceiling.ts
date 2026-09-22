/**
 * The hourly ceiling on upstream requests, as an object the handler asks
 * before relaying — counted in an external store, so the promise survives the
 * process that made it (#1810).
 *
 * THE WINDOW is the FIXED UTC CLOCK HOUR the clock names: the key is derived
 * from the clock alone, which is what lets two instances agree on one budget
 * without coordinating, and what "100 requests per hour" means to the operator
 * who was told it. A fixed hour admits a burst across its boundary — up to the
 * ceiling at the end of one hour and up to it again at the start of the next —
 * and a rolling window would not; the ceiling the upstream was given is stated
 * per hour, so the hour is what is enforced.
 *
 * WHY THE STORE. In-memory, a deploy, a key rotation or a crash started a
 * fresh hour, so the service could relay a second hour's worth inside the
 * upstream's original one — while `docs/ops/anitabi-egress.md` stated the
 * ceiling as enforced. The count now lives outside the process, keyed by the
 * hour, and both instances of the service (and every future restart within the
 * hour) spend from the same one.
 *
 * FAIL CLOSED. A store that does not answer yields `store-unavailable`, and
 * the handler refuses. There is deliberately no in-memory fallback: it would
 * silently restore exactly the behaviour this replaced, in the one situation
 * where the promise is already under strain.
 *
 * THE STORE IS NOT THE DATA PLANE. It holds one integer per hour — a count of
 * requests, keyed by the hour and nothing else. No user data, no data-plane
 * credential, and no write path beyond that key's increment (see the operating
 * doc's "What this service must never have").
 */

/** One hour in seconds — the window, and the unit the agreement is written in. */
const WINDOW_SECONDS = 60 * 60;

/**
 * The window's namespace in a store that may hold other keys. It names this
 * service and this counter, and nothing about a deployment: a second instance
 * derives the same string, which is the whole mechanism.
 */
const WINDOW_KEY_PREFIX = "anitabi-egress:upstream-requests";

/** The window key for the fixed clock hour containing `nowSeconds`. */
export function ceilingWindowOf(nowSeconds: number): string {
  const hourStart = Math.floor(nowSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;
  return `${WINDOW_KEY_PREFIX}:${String(hourStart)}`;
}

/**
 * The external counter the ceiling reads. `increment` counts one request
 * against `window` and answers with that window's total AFTER it.
 *
 * A store that cannot answer REJECTS. It never answers a lower number and
 * never answers zero: the ceiling's refusal depends on that distinction being
 * the store's, not this process's guess.
 */
export interface CeilingStore {
  increment(window: string): Promise<number>;
}

/**
 * What one request may do: go upstream, be refused by the ceiling, or be
 * refused because the service cannot tell — three outcomes, because collapsing
 * the last two would report a store outage as a request the upstream never got.
 */
export type CeilingDecision = "granted" | "exhausted" | "store-unavailable";

export class UpstreamRequestCeiling {
  constructor(
    private readonly limit: number,
    private readonly store: CeilingStore,
    private readonly nowSeconds: () => number = defaultNowSeconds,
  ) {}

  /** Count one upstream request against this hour's window, or refuse it. */
  async tryAcquire(): Promise<CeilingDecision> {
    let used: number;
    try {
      used = await this.store.increment(ceilingWindowOf(this.nowSeconds()));
    } catch {
      return "store-unavailable";
    }
    return used <= this.limit ? "granted" : "exhausted";
  }
}

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
