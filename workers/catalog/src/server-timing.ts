/**
 * Staging's popular read answers `Server-Timing`, so the CD probe that requests it after a deploy
 * (`.github/scripts/catalog-first-request.sh`) shows where catalog spent the request: the database
 * connect, which opens the connection before it returns (`./db/prisma`), the query, and catalog's
 * total. Hono's `timing` middleware keeps the timers and writes the header; this module says where
 * it runs and how request code times a segment.
 *
 * The header carries metric names and milliseconds only (`db-connect;dur=40.0,…`). A name is one of
 * the literals below, never a host, a credential, SQL or anything the request sent, and the total
 * carries no description. Only staging writes it: timings in a public answer are an exposure of
 * their own, and only staging, behind Cloudflare Access, needs the reading.
 */
import type { Context } from "hono";
import { endTime, startTime, timing } from "hono/timing";
import { runtimeEnvironment } from "./operational-config";

/** The segments a request times, by the metric name the header gives each. */
type TimedSegment = "db-connect" | "db-query";

/** How request code times a segment of its work. */
export interface SegmentTimer {
  measure<T>(segment: TimedSegment, work: () => PromiseLike<T>): Promise<T>;
}

/** Whether this Worker is staging's, read from `ENVIRONMENT` as the cron guards read it. */
function onStaging(c: Context<{ Bindings: { ENVIRONMENT?: string } }>): boolean {
  return runtimeEnvironment(c.env.ENVIRONMENT) === "staging";
}

/** The timers and the header for the route this is mounted on; the header on staging alone. */
export const serverTiming = timing({ enabled: onStaging, totalDescription: "" });

const UNTIMED: SegmentTimer = { measure: async (_segment, work) => await work() };

/** How the request behind `c` times its segments: by `serverTiming`'s timers when its route runs it. */
export function segmentTimer(c: Context): SegmentTimer {
  if (c.get("metric") === undefined) return UNTIMED;
  return { measure: (segment, work) => timed(c, segment, work) };
}

/** Run `work` between the start and the end of its segment's timer, whether or not it succeeds. */
async function timed<T>(c: Context, segment: TimedSegment, work: () => PromiseLike<T>): Promise<T> {
  startTime(c, segment);
  try {
    return await work();
  } finally {
    endTime(c, segment);
  }
}
