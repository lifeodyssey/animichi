/// <reference types="@cloudflare/workers-types" />

/**
 * The singleton `RunSweeper` Durable Object — the at-least-once backstop of
 * the whole turn machinery (spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`
 * §三, issue #1251).
 *
 * WHY IT IS NOT THE SESSION'S OWN DO: the intake commits its transaction and
 * then arms the session (`setAlarm(now)`). A crash in between leaves a
 * committed `running` run whose session instance was never armed, so that
 * instance's alarm will never fire to notice — a backstop living there could
 * not run. One instance for the whole Worker, on a periodic alarm, is what
 * closes that window: it scans `runs` for `running` rows whose lease is
 * expired or was never taken and re-arms each row's session.
 *
 * WHY RE-ARMING IS ALWAYS SAFE: the sweep never writes `runs`. Waking a
 * session whose turn IS being executed changes nothing, because the
 * AgentSession lease decides who runs a turn (spec §三, "扫描幂等（重复叫醒无
 * 副作用，由 DO 侧租约保证）") — the second wake-up finds the lease held and
 * returns. That is what makes the pair at-least-once rather than a race.
 *
 * The class stays a plain Durable Object (like `EdgeGuard`): no
 * `cloudflare:workers` import, so every module it touches is importable under
 * `node:test`.
 */
import { withAgentDatabase } from "../../db/agent-database.ts";
import type { NamedStubs } from "../durable-namespace.ts";
import { durableSessionWakeup } from "../session/session-wakeup.ts";
import { NeonRunLeases } from "./neon-run-leases.ts";
import type { RunBackstop } from "./run-backstop.ts";
import { RUN_SWEEP_SCHEDULE_PATH } from "./run-backstop.ts";
import { sweepIntervalMs, sweepRuns } from "./run-sweep.ts";

/** The binding name of the AgentSession namespace this wakes (card #1252). */
export const AGENT_SESSION_BINDING = "AGENT_SESSION";

/** The wrangler var that sets the sweep cadence. */
export const SWEEP_INTERVAL_VAR = "RUN_SWEEP_INTERVAL_SECONDS";

/**
 * Inside the sweeper the backstop is already ticking — this alarm armed the
 * next tick before it did any work — and a Durable Object that fetches its own
 * stub deadlocks on its own input gate. So the wake-up it builds schedules
 * nothing.
 */
const ALREADY_TICKING: RunBackstop = { ensureScheduled: () => Promise.resolve() };

function isNamedStubs(value: unknown): value is NamedStubs {
  if (typeof value !== "object" || value === null) return false;
  return "idFromName" in value && typeof value.idFromName === "function";
}

/** The AgentSession namespace, or a loud failure — never a silent no-op sweep. */
function sessionsIn(env: Record<string, unknown>): NamedStubs {
  const sessions = env[AGENT_SESSION_BINDING];
  if (!isNamedStubs(sessions)) throw new Error(`${AGENT_SESSION_BINDING} is not bound`);
  return sessions;
}

export class RunSweeper {
  readonly #storage: DurableObjectStorage;
  readonly #env: Record<string, unknown>;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.#storage = ctx.storage;
    this.#env = env;
  }

  /** `POST /schedule` from the live path: start ticking if nothing is armed. */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== RUN_SWEEP_SCHEDULE_PATH) {
      return new Response("Not found", { status: 404 });
    }
    if ((await this.#storage.getAlarm()) === null) await this.#armNextTick();
    return new Response(null, { status: 204 });
  }

  /** The next tick is armed BEFORE the work: a sweep that throws must not be
   * the last one that ever runs. Re-arming is idempotent, so the platform's
   * own alarm retry stays additive rather than load-bearing. */
  async alarm(): Promise<void> {
    await this.#armNextTick();
    await this.#sweepOnce();
  }

  async #armNextTick(): Promise<void> {
    await this.#storage.setAlarm(Date.now() + sweepIntervalMs(this.#env[SWEEP_INTERVAL_VAR]));
  }

  async #sweepOnce(): Promise<number> {
    const wakeup = durableSessionWakeup(sessionsIn(this.#env), ALREADY_TICKING);
    return withAgentDatabase(this.#env, (transactions) =>
      sweepRuns(new NeonRunLeases(transactions), wakeup, Date.now()));
  }
}
