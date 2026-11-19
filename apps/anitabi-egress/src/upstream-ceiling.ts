/**
 * The ceiling on upstream requests in any hour, as an object the handler asks
 * before relaying — kept in an external store, so the promise survives the
 * process that made it (#1810).
 *
 * THE WINDOW is the last 3600 seconds, rolling (`rolling-window-script.ts`):
 * any 3600 seconds hold at most the limit, so a burst can no longer spend the
 * ceiling at the end of one clock hour and again at the start of the next, as
 * a fixed hour allowed. The store keeps the window and decides each admission
 * itself, in one script on its own clock, which is what lets two instances
 * agree on one budget without coordinating.
 *
 * WHY THE STORE. In-memory, a deploy, a key rotation or a crash started a
 * fresh hour, so the service could relay a second hour's worth inside the
 * upstream's original one — while `docs/ops/anitabi-egress.md` stated the
 * ceiling as enforced. The window now lives outside the process, and both
 * instances of the service (and every future restart) spend from the same one.
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
 * THE STORE IS NOT THE DATA PLANE. It holds one window — a second and a random
 * id for each admission of the last hour, under one key named for this service.
 * No user data, no data-plane credential, and no write path beyond that window
 * (see the operating doc's "What this service must never have").
 */

/**
 * What the ceiling asks the store for each request: its limit, and the
 * egress's clock. The service's store keeps its window on its own clock and
 * reads this one only where a test hands it a clock that does.
 */
export interface AdmissionRequest {
  readonly nowSeconds: number;
  readonly limit: number;
}

/** The window's decision on one request. A refusal is not recorded. */
export type Admission = "admitted" | "refused";

/**
 * The external window the ceiling asks. `admit` admits one request if the last
 * hour holds fewer than `limit`, records it, and answers which it was.
 *
 * A store that cannot answer REJECTS. It never answers a decision it did not
 * make: the ceiling's refusal depends on that distinction being the store's,
 * not this process's guess.
 */
export interface CeilingStore {
  admit(request: AdmissionRequest): Promise<Admission>;
}

/**
 * Why a store could not answer, as the one word an operator groups by (#1833).
 *
 * The four reply-set codes are the guards #1825 added, and they are four codes
 * rather than one because they are four different things to fix: a store that
 * answered a conversation it was not asked, a credential it refused, a window
 * it left without an expiry, and a window that answered no decision. They are
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
  | "decision"
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
 * once per failed admission, before the refusal is returned.
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

  /** Ask the store to admit one upstream request into the last hour's window, or refuse it. */
  async tryAcquire(): Promise<CeilingDecision> {
    let admission: Admission;
    try {
      admission = await this.store.admit({ nowSeconds: this.nowSeconds(), limit: this.limit });
    } catch (cause) {
      this.reportStoreFailure(failureFrom(cause));
      return "store-unavailable";
    }
    return admission === "admitted" ? "granted" : "exhausted";
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
