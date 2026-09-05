/**
 * The Neon Auth access token the staging turns present, minted and re-minted.
 *
 * A held value with an age, not a variable read once. `api-test/`'s lanes take
 * `AGENT_TURN_BEARER` from the environment because a lane is four requests
 * long; an eval run is hundreds of turns over tens of minutes, and the JWT
 * lives **15 minutes** (`docs/ops/auth-migration-neon.md` §4). A run that read a
 * token from a file at the start would fail its second half with 401s that look
 * like an auth regression — which is exactly the misdiagnosis this class exists
 * to prevent.
 *
 * The clock is injected for the same reason every other clock in this repo is:
 * a re-mint rule that can only be observed by waiting fourteen minutes is a rule
 * nobody tests.
 */

/**
 * How long one minted token is reused. A minute short of the 15-minute JWT
 * lifetime, because a turn admitted at 14:59 still has up to 100 seconds of
 * model time ahead of it and must not spend it holding an expired credential.
 */
export const BEARER_MAX_AGE_MS = 14 * 60_000;

/** One sign-in, producing one fresh access token. */
export type MintBearer = () => Promise<string>;

export class StagingBearer {
  readonly #mint: MintBearer;
  readonly #now: () => number;
  #token: string | null = null;
  #mintedAt = 0;
  #minting: Promise<string> | null = null;

  constructor(mint: MintBearer, now: () => number) {
    this.#mint = mint;
    this.#now = now;
  }

  /** The token to present, minting a new one when the held one is too old. */
  current(): Promise<string> {
    if (this.#token !== null && this.#now() - this.#mintedAt < BEARER_MAX_AGE_MS) {
      return Promise.resolve(this.#token);
    }
    this.#minting ??= this.#mintOnce();
    return this.#minting;
  }

  /** One mint shared by every caller that arrived while it was in flight: N
   * concurrent turns finding the token stale is one sign-in, not N. */
  async #mintOnce(): Promise<string> {
    try {
      this.#token = await this.#mint();
      this.#mintedAt = this.#now();
      return this.#token;
    } finally {
      this.#minting = null;
    }
  }
}
