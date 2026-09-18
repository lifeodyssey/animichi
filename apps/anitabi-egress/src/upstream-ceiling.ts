/**
 * The hourly ceiling on upstream requests, as an object the handler asks
 * before relaying. Fixed one-hour window: the first request after a window
 * elapses starts the next one. In-memory on purpose — this service is one
 * Fly app with one machine, because the app boundary IS the allowlisted
 * address boundary (#1792); a second instance would be a second address, so
 * the state never needs to leave this process.
 */

/** The ceiling: at most `limit` upstream requests in any rolling-fixed hour. */
export class UpstreamRequestCeiling {
  private windowStartSeconds: number;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly nowSeconds: () => number = defaultNowSeconds,
  ) {
    this.windowStartSeconds = nowSeconds();
  }

  /** Consume one upstream request slot, or refuse it. */
  tryAcquire(): boolean {
    this.rollWindowIfElapsed();
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  private rollWindowIfElapsed(): void {
    const now = this.nowSeconds();
    if (now - this.windowStartSeconds >= 60 * 60) {
      this.windowStartSeconds = now;
      this.used = 0;
    }
  }
}

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
