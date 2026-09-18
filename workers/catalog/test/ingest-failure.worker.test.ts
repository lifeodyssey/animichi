/**
 * The ingest failure taxonomy (#1784): a refusal from the upstream is parked as
 * its own kind, separately from an upstream fault, and neither is retried the
 * way the other is. Every upstream answer comes from a fetch double.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INGEST_TTL,
  IngestBangumi,
  type IngestSource,
  type IngestStore,
} from "../src/ingest/ingest-bangumi";
import type { FailureOptions } from "../src/ingest/jobs";
import { consoleRefusalAlarm, type UpstreamRefusal } from "../src/ingest/refusal-alarm";
import { fetchAnitabiPoints, type FetchLike } from "../src/ingest/sources";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { lenientEgressFetch, stubEgressSigningKey } from "./egress-stub";
import { fakeSleep, mockFetchSequence } from "./mock-fetch-sequence";

const WORK = "276";
/** The URL the row records is the one we actually call: the egress operation (#1792). */
const DETAIL_URL = `${ANITABI_EGRESS_BASE_URL}/anitabi/points/${WORK}`;

interface Upstream {
  source: IngestSource;
  requests: () => number;
  waits: number[];
}

/** Anitabi answering every request with `status`; Bangumi answers normally. */
function anitabiAnswering(status: number): Upstream {
  const { fetch, callCount } = mockFetchSequence([1, 2, 3].map(() => ({ status, body: null })));
  // The service relays the upstream's answer, so the double stamps the relayed
  // marker: an answer that reached us through the egress.
  const upstream = anitabiAnsweringWith(lenientEgressFetch(fetch));
  return { ...upstream, requests: callCount };
}

/**
 * The same double over an arbitrary fetch, passed through untouched — the
 * caller's double carries whatever markers its scenario is about, so a
 * refusal from OUR egress stays marked as ours.
 */
function anitabiAnsweringWith(fetch: FetchLike): Upstream {
  const { sleep, waits } = fakeSleep();
  let requests = 0;
  const count = () => requests;
  const retry = { sleep, jitterMs: (ms: number) => ms };
  const source: IngestSource = {
    fetchBangumi: () => Promise.resolve({ id: 276 }),
    fetchPoints: (bangumiId) =>
      fetchAnitabiPoints(bangumiId, {
        fetchImpl: (url, init) => {
          requests += 1;
          return fetch(url, init);
        },
        egressSigningKey: stubEgressSigningKey(),
        retry,
      }),
  };
  return { source, requests: count, waits };
}

interface Parked {
  store: IngestStore;
  failures: FailureOptions[];
  liveRefusals: Set<string>;
}

function parkedStore(): Parked {
  const failures: FailureOptions[] = [];
  const liveRefusals = new Set<string>();
  const store: IngestStore = {
    acquire: () => Promise.resolve(true),
    guard: () => Promise.resolve("ready"),
    ensurePending: () => Promise.resolve(),
    markDone: () => Promise.resolve(),
    markFailed: (_id, opts) => { failures.push(opts); return Promise.resolve(); },
    hasLiveRefusal: (upstream) => Promise.resolve(liveRefusals.has(upstream)),
    saveRawBangumi: () => Promise.resolve(),
    saveRawAnitabi: () => Promise.resolve(),
  };
  return { store, failures, liveRefusals };
}

const unusedPublisher = { publish: () => Promise.reject(new Error("must not publish")) };

async function ingestAgainst(upstream: Upstream, parked: Parked, raised: UpstreamRefusal[] = []): Promise<FailureOptions> {
  const ingest = boundIngest(upstream, parked, raised);
  await expect(ingest.ingest(WORK)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  return parkedFailure(parked);
}

/**
 * The same ingest where the failure is OURS (#1792): an egress refusal parks
 * and reports a failed status rather than being rethrown as an upstream 502 —
 * the upstream never answered, and the ceiling clears within the hour.
 */
async function ingestParkedAgainst(upstream: Upstream, parked: Parked, raised: UpstreamRefusal[] = []): Promise<FailureOptions> {
  const result = await boundIngest(upstream, parked, raised).ingest(WORK);
  expect(result.status).toBe("failed");
  return parkedFailure(parked);
}

function boundIngest(upstream: Upstream, parked: Parked, raised: UpstreamRefusal[]): IngestBangumi {
  const alarm = { upstreamRefused: (refusal: UpstreamRefusal) => { raised.push(refusal); } };
  return new IngestBangumi(upstream.source, parked.store, unusedPublisher, DEFAULT_INGEST_TTL, alarm);
}

function parkedFailure(parked: Parked): FailureOptions {
  const [failure] = parked.failures;
  if (failure === undefined) throw new Error("the failure was not parked");
  return failure;
}

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

describe("the refusal alarm", () => {
  it("raises the first refusal from a source with what to do about it", async () => {
    const raised: UpstreamRefusal[] = [];

    await ingestAgainst(anitabiAnswering(403), parkedStore(), raised);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ upstream: "anitabi", workId: WORK });
    expect(raised[0]?.detail).toContain("retrying will not help");
  });

  it("stays silent while the same source already has a live refusal on record", async () => {
    const raised: UpstreamRefusal[] = [];
    const parked = parkedStore();
    parked.liveRefusals.add("anitabi");

    await ingestAgainst(anitabiAnswering(403), parked, raised);

    expect(raised).toEqual([]);
  });

  it("raises nothing for a fault", async () => {
    const raised: UpstreamRefusal[] = [];

    await ingestAgainst(anitabiAnswering(500), parkedStore(), raised);

    expect(raised).toEqual([]);
  });
});

describe("the default refusal alarm", () => {
  it("writes one structured error record keyed on the refusal event", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    consoleRefusalAlarm().upstreamRefused({ upstream: "anitabi", workId: WORK, detail: "refused" });

    expect(error).toHaveBeenCalledExactlyOnceWith({
      event: "ingest.upstream_refused", upstream: "anitabi", work_id: WORK, detail: "refused",
    });
    error.mockRestore();
  });
});
