/**
 * The doubles an ingest failure is driven through in the worker pool: an
 * Anitabi upstream answering through the egress, a store that records what a
 * failure parks, and the ingest run over the two. Two suites build them, so
 * they are named here once, for what they construct
 * (`.claude/rules/naming-ownership.md`): `ingest-failure.worker.test.ts` holds
 * the failure taxonomy and `refusal-alarm.worker.test.ts` the refusal alarm.
 */
import { expect } from "vitest";
import {
  DEFAULT_INGEST_TTL,
  IngestBangumi,
  type IngestSource,
  type IngestStore,
} from "../src/ingest/ingest-bangumi";
import type { FailureOptions } from "../src/ingest/jobs";
import type { UpstreamRefusal } from "../src/ingest/refusal-alarm";
import { fetchAnitabiPoints, type FetchLike } from "../src/ingest/sources";
import { lenientEgressFetch, stubEgressSigningKey } from "./egress-stub";
import { claimOn } from "./fixtures/job-claim";
import { fakeSleep, mockFetchSequence } from "./mock-fetch-sequence";

export const WORK = "276";

export interface Upstream {
  source: IngestSource;
  requests: () => number;
  waits: number[];
}

/** Anitabi answering every request with `status`; Bangumi answers normally. */
export function anitabiAnswering(status: number): Upstream {
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
export function anitabiAnsweringWith(fetch: FetchLike): Upstream {
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

export interface Parked {
  store: IngestStore;
  failures: FailureOptions[];
  liveRefusals: Set<string>;
}

export function parkedStore(): Parked {
  const failures: FailureOptions[] = [];
  const liveRefusals = new Set<string>();
  const store: IngestStore = {
    acquire: (id) => Promise.resolve(claimOn(id)),
    guard: () => Promise.resolve("ready"),
    ensurePending: () => Promise.resolve(),
    markDone: () => Promise.resolve("recorded"),
    markFailed: (_claim, opts) => { failures.push(opts); return Promise.resolve("recorded"); },
    hasLiveRefusal: (upstream) => Promise.resolve(liveRefusals.has(upstream)),
    saveRawBangumi: () => Promise.resolve(),
    saveRawAnitabi: () => Promise.resolve(),
  };
  return { store, failures, liveRefusals };
}

const unusedPublisher = { publish: () => Promise.reject(new Error("must not publish")) };

export async function ingestAgainst(upstream: Upstream, parked: Parked, raised: UpstreamRefusal[] = []): Promise<FailureOptions> {
  const ingest = boundIngest(upstream, parked, raised);
  await expect(ingest.ingest(WORK)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  return parkedFailure(parked);
}

/**
 * The same ingest where the failure is OURS (#1792): an egress refusal parks
 * and reports a failed status rather than being rethrown as an upstream 502 —
 * the upstream never answered, and the ceiling clears within the hour.
 */
export async function ingestParkedAgainst(upstream: Upstream, parked: Parked, raised: UpstreamRefusal[] = []): Promise<FailureOptions> {
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
