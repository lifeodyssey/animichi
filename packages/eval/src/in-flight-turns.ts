/**
 * How many turns this runner may have open against staging at once.
 *
 * A bound rather than a rate limiter, because what is being protected is a
 * shared deployment answering with real model time: 33 held-out cases dispatched
 * at once would be 33 concurrent runs on one signed-in QA identity, which is a
 * load test wearing an eval's clothes. Two is the starting point (W3-2 #1300);
 * it is a constructor argument so raising it is a measured decision rather than
 * an edit to a constant.
 *
 * THE SLOT IS TAKEN BEFORE THE WORK STARTS, which is the whole reason this is a
 * gate around `run` rather than a counter the caller checks. A per-case timeout
 * armed before admission would spend its budget waiting in line and fail a turn
 * that was never given a chance to run.
 */
export class InFlightTurns {
  readonly #limit: number;
  readonly #waiting: (() => void)[] = [];
  #active = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`in-flight limit must be a positive integer, got ${String(limit)}`);
    }
    this.#limit = limit;
  }

  /** Run `work` once a slot is free, and hand the slot on afterwards. */
  async enter<T>(work: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await work();
    } finally {
      this.#release();
    }
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((admit) => this.#waiting.push(admit));
  }

  /** Hand the slot to whoever is waiting; only an empty queue frees it. */
  #release(): void {
    const next = this.#waiting.shift();
    if (next === undefined) {
      this.#active -= 1;
      return;
    }
    next();
  }
}
