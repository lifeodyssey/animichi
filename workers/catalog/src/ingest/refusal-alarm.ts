/**
 * The refusal alarm (#1784): the one signal an upstream refusing this client
 * raises, as opposed to the per-job rows it parks.
 *
 * A source that refuses every request refuses every job, so the alarm is keyed
 * on the source, not the job: it is raised only when no live `upstream_refused`
 * row for the same source is already on record (`hasLiveRefusal` in `jobs.ts`).
 * The parked rows are the ledger — nothing else is stored. One alarm speaks
 * for the source as long as any of its refusals stays live, re-parked by each
 * daily recheck; only after every refused row has lapsed does the next refusal
 * start a new episode and raise a new alarm. Two refusals racing in parallel
 * requests can each see an empty ledger, so the bound is one per concurrent
 * racer, not strictly one.
 */
import type { UpstreamName } from "./upstream-failures";

/** One source's refusal, as the first job to meet it saw it. */
export interface UpstreamRefusal {
  readonly upstream: UpstreamName;
  readonly workId: string;
  /** The parked row's text: the refused URL and status, then what to do. */
  readonly detail: string;
}

/** Where a refusal goes once it is due; injectable so the count is testable. */
export interface RefusalAlarm {
  upstreamRefused(refusal: UpstreamRefusal): void;
}

/** The stable event name a log search or an alert rule keys on. */
export const UPSTREAM_REFUSED_EVENT = "ingest.upstream_refused";

/** The default alarm: one structured error record in the Worker's own logs. */
export function consoleRefusalAlarm(): RefusalAlarm {
  return { upstreamRefused: logRefusal };
}

function logRefusal(refusal: UpstreamRefusal): void {
  console.error({ event: UPSTREAM_REFUSED_EVENT, upstream: refusal.upstream, work_id: refusal.workId, detail: refusal.detail });
}
