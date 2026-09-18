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
import { fetchAnitabiPoints } from "../src/ingest/sources";
import { fakeSleep, mockFetchSequence } from "./mock-fetch-sequence";

const WORK = "276";
const DETAIL_URL = `https://api.anitabi.cn/bangumi/${WORK}/points/detail?haveImage=true`;

interface Upstream {
  source: IngestSource;
  requests: () => number;
  waits: number[];
}

/** Anitabi answering every request with `status`; Bangumi answers normally. */
function anitabiAnswering(status: number): Upstream {
  const { sleep, waits } = fakeSleep();
  const { fetch, callCount } = mockFetchSequence([1, 2, 3].map(() => ({ status, body: null })));
  const retry = { sleep, jitterMs: (ms: number) => ms };
  const source: IngestSource = {
    fetchBangumi: () => Promise.resolve({ id: 276 }),
    fetchPoints: (bangumiId) => fetchAnitabiPoints(bangumiId, { fetchImpl: fetch, retry }),
  };
  return { source, requests: callCount, waits };
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
  const alarm = { upstreamRefused: (refusal: UpstreamRefusal) => { raised.push(refusal); } };
  const ingest = new IngestBangumi(upstream.source, parked.store, unusedPublisher, DEFAULT_INGEST_TTL, alarm);
  await expect(ingest.ingest(WORK)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
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
