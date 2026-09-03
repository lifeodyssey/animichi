/// <reference types="@cloudflare/workers-types" />

/**
 * Keeping the at-least-once backstop ticking (spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三, issue #1251).
 *
 * The backstop is a SINGLETON `RunSweeper` Durable Object with a periodic
 * alarm, and it has to be independent of any session's own DO: the failure it
 * exists for is a crash between the intake's COMMIT and its `setAlarm`, which
 * leaves the session's instance unarmed, so that instance's alarm never fires
 * to notice. A Durable Object alarm only runs if something scheduled it, so
 * this port is how the live path keeps the singleton armed without a cron
 * trigger — `ensureScheduled` is idempotent and cheap (the DO re-arms itself
 * after every sweep, so the common case writes nothing).
 */
import type { NamedStubs } from "../durable-namespace.ts";

/** The singleton's instance name — one sweeper for the whole Worker. */
export const RUN_SWEEPER_SINGLETON = "run-sweeper";

/** The path a schedule request carries. */
export const RUN_SWEEP_SCHEDULE_PATH = "/schedule";

/** The sweeper's own schedule, seen from the live path. */
export interface RunBackstop {
  ensureScheduled(): Promise<void>;
}

/** The request `RunSweeper.fetch` answers by arming its periodic alarm. */
export function scheduleRequest(): Request {
  return new Request(`https://run-sweeper${RUN_SWEEP_SCHEDULE_PATH}`, { method: "POST" });
}

/** The production backstop: the one singleton instance, addressed by name. */
export function durableRunBackstop(sweepers: NamedStubs): RunBackstop {
  return {
    async ensureScheduled() {
      await sweepers.get(sweepers.idFromName(RUN_SWEEPER_SINGLETON)).fetch(scheduleRequest());
    },
  };
}
