/**
 * The ingest failure taxonomy (#1784): a refusal from the upstream is parked as
 * its own kind, separately from an upstream fault, and neither is retried the
 * way the other is. Every upstream answer comes from a fetch double
 * (`./ingest-failure-doubles`); the alarm a parked refusal raises is
 * `refusal-alarm.worker.test.ts`'s subject.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_INGEST_TTL } from "../src/ingest/ingest-bangumi";
import type { UpstreamRefusal } from "../src/ingest/refusal-alarm";
import type { FetchLike } from "../src/ingest/sources";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import {
  anitabiAnswering, anitabiAnsweringWith, ingestAgainst, ingestParkedAgainst, parkedStore, WORK,
} from "./ingest-failure-doubles";

/** The URL the row records is the one we actually call: the egress operation (#1792). */
const DETAIL_URL = `${ANITABI_EGRESS_BASE_URL}/anitabi/points/${WORK}`;

describe("an upstream refusal is not an upstream fault", () => {
  it("parks a 403 as a refusal that names the source and says retrying will not help", async () => {
    const failure = await ingestAgainst(anitabiAnswering(403), parkedStore());

    expect(failure.errorCode).toBe("upstream_refused");
    expect(failure.stage).toBe("fetch:anitabi");
    expect(failure.error).toContain(`${DETAIL_URL} (403)`);
    expect(failure.error).toContain("retrying will not help");
  });

  it("parks a 500 that outlasted its retries as a fault that is retried automatically", async () => {
    const failure = await ingestAgainst(anitabiAnswering(500), parkedStore());

    expect(failure.errorCode).toBe("upstream_fault");
    expect(failure.stage).toBe("fetch:anitabi");
    expect(failure.error).toContain(`${DETAIL_URL} (500)`);
    expect(failure.error).toContain("retried automatically");
  });
});

describe("a refusal is not retried as a transient fault", () => {
  it("asks the refusing upstream exactly once, with no backoff", async () => {
    const upstream = anitabiAnswering(403);

    await ingestAgainst(upstream, parkedStore());

    expect(upstream.requests()).toBe(1);
    expect(upstream.waits).toEqual([]);
  });

  it("parks a refusal for the refusal TTL, not the hourly fault TTL", async () => {
    const failure = await ingestAgainst(anitabiAnswering(403), parkedStore());

    expect(failure.ttlSeconds).toBe(DEFAULT_INGEST_TTL.refusalSeconds);
    expect(DEFAULT_INGEST_TTL.refusalSeconds).toBeGreaterThan(DEFAULT_INGEST_TTL.failureSeconds);
  });
});

describe("our egress refusing is its own kind, never an upstream answer", () => {
  it("parks an egress ceiling refusal under the egress code, naming us as the refuser", async () => {
    const ceilingFetch: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) =>
            name === "x-egress-response" ? "refused-here" : name === "x-egress-refusal" ? "ceiling" : null,
        },
        json: () => Promise.resolve({ reason: "ceiling" }),
      });
    const upstream = anitabiAnsweringWith(ceilingFetch);
    const failure = await ingestParkedAgainst(upstream, parkedStore());

    expect(failure.errorCode).toBe("egress_refused");
    expect(failure.error).toContain("the anitabi egress refused this request (ceiling)");
    expect(failure.error).toContain("do NOT contact the upstream");
    expect(failure.ttlSeconds).toBe(DEFAULT_INGEST_TTL.egressSeconds);
  });

  it("parks an egress refusal for the hour — never the upstream refusal's 24h", () => {
    expect(DEFAULT_INGEST_TTL.egressSeconds).toBeLessThanOrEqual(60 * 60);
    expect(DEFAULT_INGEST_TTL.egressSeconds).toBeLessThan(DEFAULT_INGEST_TTL.refusalSeconds);
  });

  it("an egress auth refusal raises no upstream refusal alarm — the upstream never saw it", async () => {
    const authFetch: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        headers: {
          get: (name: string) =>
            name === "x-egress-response" ? "refused-here" : name === "x-egress-refusal" ? "auth" : null,
        },
        json: () => Promise.resolve({ reason: "auth" }),
      });
    const raised: UpstreamRefusal[] = [];
    const failure = await ingestParkedAgainst(anitabiAnsweringWith(authFetch), parkedStore(), raised);

    expect(raised).toEqual([]);
    expect(failure.errorCode).toBe("egress_refused");
  });

  it("distinguishes our refusal from the upstream's on the same 403 status", async () => {
    const upstreamRefused = await ingestAgainst(anitabiAnswering(403), parkedStore());
    const oursRefused = await ingestParkedAgainst(anitabiAnsweringWith(egressRefusing("ceiling", 403)), parkedStore());

    expect(upstreamRefused.errorCode).toBe("upstream_refused");
    expect(oursRefused.errorCode).toBe("egress_refused");
    expect(upstreamRefused.ttlSeconds).not.toBe(oursRefused.ttlSeconds);
  });
});

/** A refusal of any status, marked unmistakably as this service's own. */
function egressRefusing(reason: string, status: number): FetchLike {
  return () =>
    Promise.resolve({
      ok: false,
      status,
      headers: {
        get: (name: string) =>
          name === "x-egress-response" ? "refused-here" : name === "x-egress-refusal" ? reason : null,
      },
      json: () => Promise.resolve({ refusedBy: "anitabi-egress", reason }),
    });
}
