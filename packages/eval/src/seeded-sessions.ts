/**
 * Which session a case's frozen prefix was seeded into (E-1 #1380).
 *
 * A prefix and the turn it precedes have to land in the SAME session, and the
 * two halves are decided in two places the driver keeps apart: `logfire/evals`
 * runs `CaseLifecycle.setup()` before the task and hands neither one a channel
 * to the other. What it DOES hand both is the case's own `inputs` object —
 * `new Lifecycle(case)` and `task(case.inputs)` are the same reference — so
 * that object is the key, and a `WeakMap` is the register.
 *
 * WHY NOT THE CASE NAME: the task is given inputs and nothing else. Threading a
 * name through would mean either a second dataset field or a global keyed by a
 * string two cases could share; object identity is already unique and already
 * scoped to one run of one case.
 *
 * `repeat` is the one shape this cannot serve, and it is refused rather than
 * silently mis-served: two runs of one case share one inputs object, so the
 * second would claim a session the first is measuring. Neither eval entry sets
 * `repeat`, and `claim` says so out loud if one ever does.
 */

/** A session id already claimed for a case that is being run again. */
export class SessionAlreadyClaimedError extends Error {
  constructor() {
    super("a prefix session is already claimed for this case — `repeat` is not supported with seeded prefixes");
    this.name = "SessionAlreadyClaimedError";
  }
}

export class SeededSessions {
  readonly #byInputs = new WeakMap<object, string>();

  /** Record the session one case's prefix was seeded into. */
  claim(inputs: object, sessionId: string): void {
    if (this.#byInputs.has(inputs)) throw new SessionAlreadyClaimedError();
    this.#byInputs.set(inputs, sessionId);
  }

  /** The session a case's turns must run on, or null when it seeded none. */
  of(inputs: object): string | null {
    return this.#byInputs.get(inputs) ?? null;
  }
}
