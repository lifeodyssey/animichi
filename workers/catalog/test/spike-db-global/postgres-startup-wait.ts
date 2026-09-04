/** The window in which Postgres holds the port open but refuses sessions.
 *
 * testcontainers' default host-port wait settles once port 5432 is bound. The
 * postgis image's entrypoint runs its init scripts against a Unix socket first,
 * shuts that temporary server down, and only then starts the real one, which
 * binds TCP before it finishes starting — every connection landing in that
 * bind-then-ready gap is rejected with SQLSTATE 57P03, "the database system is
 * starting up". The container wait strategy (two `ready to accept connections`
 * log lines) closes nearly all of it; this bounded probe closes the rest
 * without ever swallowing a failure that is not a startup symptom. */

/** SQLSTATE 57P03 plus the pre-listen socket refusals — the startup symptoms. */
const STARTUP_CODES: ReadonlySet<string> = new Set(["57P03", "ECONNREFUSED", "ECONNRESET"]);

/** How far the wait may go before it declares the container broken. */
export interface StartupWaitLimits {
  readonly attemptCeiling: number;
  readonly pauseMs: number;
}

/** Sleeps between attempts; injected so tests run on a fake clock. */
export type Pause = (milliseconds: number) => Promise<void>;

/** The spike suite's budget: 30 attempts a second apart. */
export const SPIKE_STARTUP_WAIT: StartupWaitLimits = { attemptCeiling: 30, pauseMs: 1_000 };

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null;
  const code: unknown = error.code;
  return typeof code === "string" ? code : null;
}

/** Whether a failed connection means "not up yet" rather than "wrong". */
export function isStartingUp(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && STARTUP_CODES.has(code);
}

type Outcome = { readonly settled: true } | { readonly settled: false; readonly failure: unknown };

async function outcomeOf(probe: () => Promise<void>): Promise<Outcome> {
  try {
    await probe();
    return { settled: true };
  } catch (failure) {
    return { settled: false, failure };
  }
}

export class PostgresStartupWait {
  constructor(
    private readonly limits: StartupWaitLimits,
    private readonly pause: Pause,
  ) {}

  /** Repeat the probe while Postgres is still starting; anything else rethrows. */
  async until(probe: () => Promise<void>): Promise<void> {
    const { attemptCeiling, pauseMs } = this.limits;
    for (let taken = 1; taken <= attemptCeiling; taken += 1) {
      const outcome = await outcomeOf(probe);
      if (outcome.settled) return;
      if (!isStartingUp(outcome.failure)) throw outcome.failure;
      if (taken < attemptCeiling) await this.pause(pauseMs);
    }
    throw new Error(`Postgres was still starting up after ${String(attemptCeiling)} connection attempts`);
  }
}
