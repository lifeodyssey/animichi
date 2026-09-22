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
 * WHO READS WHAT (#1833). The caller reads three outcomes and no more. An
 * operator reads WHY, and the two are deliberately different surfaces: the
 * three-outcome type is what keeps a store outage from being reported as a
 * request the upstream never got, and collapsing the store's failures into it
 * is what made a refused credential, a window left without an expiry and a
 * black-holed socket one indistinguishable refusal — while the diagnostics the
 * store's own guards write reached nobody at all. So the catch below BINDS its
 * cause and reports it through `CeilingStoreFailureReporter`, and the decision
 * it returns is still one of exactly three. The reporter is a required
 * collaborator rather than an optional one, because a ceiling that cannot say
 * why it refused is the defect this closes.
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
 * Why a store could not answer, as the one word an operator groups by (#1833).
 *
 * The four reply-set codes are the guards #1825 added, and they are four codes
 * rather than one because they are four different things to fix: a store that
 * answered a conversation it was not asked, a credential it refused, a window
 * it left without an expiry, and an increment that answered no count. They are
 * the diagnostics whose value was zero while nothing bound the error.
 *
 * `unreachable` is the code a rejection that names none of the others arrives
 * as. In this service that is the dial: the composition root's connection,
 * which rejects with the socket's own error — `ECONNREFUSED`, or its own
 * deadline — so the message an operator reads beside the code is the
 * connection's own words.
 */
export type CeilingStoreFailureCode =
  | "reply-count"
  | "credential"
  | "expiry"
  | "count"
  | "oversized-reply"
  | "timeout"
  | "connection"
  | "hang-up"
  | "unreachable";

/**
 * One store failure, as the operator's surface reads it: the code an operator
 * groups by, and the message the store itself wrote. It carries those two and
 * nothing else — no address, no command, no credential — which is why it is a
 * shape of its own rather than the error it was read from.
 */
export interface CeilingStoreFailure {
  readonly code: CeilingStoreFailureCode;
  readonly message: string;
}

/**
 * Where a store failure goes so an operator can read it (#1833). It is called
 * once per failed increment, before the refusal is returned.
 *
 * WHO GUARANTEES WHAT. A reporter that writes its line and returns is still
 * what a good one looks like, but the ceiling no longer DEPENDS on that: the
 * ceiling contains the reporter where the reporter enters the object — the
 * constructor — so a reporter that throws is tolerated, its throw ends at the
 * reporter, and the refusal the caller reads is unconditional. No caller has
 * to guard its call, and none ever will. The composition root installs one
 * that writes to stderr, which `fly logs` carries.
 */
export type CeilingStoreFailureReporter = (failure: CeilingStoreFailure) => void;

/**
 * A store's own refusal, carrying the code an operator reads. It lives here
 * rather than in the adapter that raises most of them because this module is
 * the store's contract: `CeilingStore` promises that a store which cannot
 * answer REJECTS, and a rejection somebody can act on is part of that promise.
 */
export class CeilingStoreError extends Error {
  constructor(readonly code: CeilingStoreFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CeilingStoreError";
  }
}

/**
 * What one request may do: go upstream, be refused by the ceiling, or be
 * refused because the service cannot tell — three outcomes, because collapsing
 * the last two would report a store outage as a request the upstream never got.
 */
export type CeilingDecision = "granted" | "exhausted" | "store-unavailable";

/**
 * The ceiling the handler asks before relaying. The reporter is contained
 * where it enters the object — the constructor holds the wrapped one, so a
 * reporter that throws ends at the reporter and the three outcomes are the
 * caller's regardless — which is why `tryAcquire` carries no guard of its own
 * and every caller of this object, present and future, reads the same answer.
 */
export class UpstreamRequestCeiling {
  private readonly reportStoreFailure: CeilingStoreFailureReporter;

  constructor(
    private readonly limit: number,
    private readonly store: CeilingStore,
    reportStoreFailure: CeilingStoreFailureReporter,
    private readonly nowSeconds: () => number = defaultNowSeconds,
  ) {
    this.reportStoreFailure = reporterThatCannotThrow(reportStoreFailure);
  }

  /** Count one upstream request against this hour's window, or refuse it. */
  async tryAcquire(): Promise<CeilingDecision> {
    let used: number;
    try {
      used = await this.store.increment(ceilingWindowOf(this.nowSeconds()));
    } catch (cause) {
      this.reportStoreFailure(failureFrom(cause));
      return "store-unavailable";
    }
    return used <= this.limit ? "granted" : "exhausted";
  }
}

/**
 * The reporter as the ceiling holds it: the one it was given, called with the
 * failure exactly as before, and tolerated when it throws. The catch is
 * deliberately empty of action: the reporter IS the operator's diagnostics
 * channel, so its own failure has no second sink left to be told to, and
 * routing the throw back through the same reporter would re-enter the code
 * that threw. The one thing a reporter's failure must never do — change the
 * answer the caller reads — is the one thing this guarantees.
 */
function reporterThatCannotThrow(report: CeilingStoreFailureReporter): CeilingStoreFailureReporter {
  return (failure) => {
    try {
      report(failure);
    } catch {
      // The reporter is the last channel; its own failure has nobody left to
      // tell, and the refusal below is the caller's regardless.
    }
  };
}

/**
 * The failure a caught value is, for the operator's surface: a store that named
 * its own code keeps it, and a rejection that named none arrives as
 * `unreachable` with the message it did carry — a store that failed without
 * saying how is still readable rather than silent, which is the whole of #1833.
 */
function failureFrom(cause: unknown): CeilingStoreFailure {
  if (cause instanceof CeilingStoreError) return { code: cause.code, message: cause.message };
  return { code: "unreachable", message: cause instanceof Error ? cause.message : String(cause) };
}

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
