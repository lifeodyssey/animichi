// The W0-S4 tests (#1247) run a five-minute turn without waiting five minutes.
//
// `sleep` is the only thing that moves the clock, so every duration the tests
// assert on — the turn's length, the lease slice, the Durable Object's billed
// wall-clock — is exactly the time the turn asked to hold for, and nothing in
// the suite depends on how fast the machine running it is.

export class AdvancingClock {
  private reading: number;

  constructor(startedAt: number) {
    this.reading = startedAt;
  }

  readonly now = (): number => this.reading;

  readonly sleep = (ms: number): Promise<void> => {
    this.reading += ms;
    return Promise.resolve();
  };
}
