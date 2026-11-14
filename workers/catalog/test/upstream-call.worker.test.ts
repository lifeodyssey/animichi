import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ATTEMPT_TIMEOUT_MS } from "../src/ingest/retry";
import { UpstreamFetchError, type FetchLike } from "../src/ingest/sources";
import { fetchJson } from "../src/ingest/upstream-call";
import type { UpstreamRequest } from "../src/ingest/upstream-requests";
import { deferred } from "./deferred";
import { abortTimeoutsOnFakeClock } from "./fakes/abort-timeout";
import { unanswered } from "./fakes/unanswered-request";

/**
 * SUT: `fetchJson`'s body read (`src/ingest/upstream-call.ts`). The upstream
 * has answered and its body is still arriving. The attempt's signal bounds that
 * read as it bounds the request: a body that stops arriving ends at the attempt
 * timeout as the upstream's failure, and a caller that cancels mid-body gets
 * its own reason back, not an upstream failure.
 */

const SUBJECT: UpstreamRequest = { upstream: "bangumi", operation: "subject", bangumiId: "276" };

/** An upstream that answers 200 at once and whose body never finishes: the read ends only when the request's signal aborts. */
function stalledBody() {
  const reading = deferred();
  const signals: AbortSignal[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    const signal = init?.signal ?? AbortSignal.abort(new Error("the upstream call carried no signal"));
    signals.push(signal);
    return Promise.resolve({ ok: true, status: 200, json: () => { reading.settle(); return unanswered(signal); } });
  };
  return { fetchImpl, signals, reading: reading.promise };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchJson body read", () => {
  it("abandons a body that stops arriving at the attempt timeout, as the upstream's failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    abortTimeoutsOnFakeClock();
    const body = stalledBody();
    const fetched = fetchJson(SUBJECT, { fetchImpl: body.fetchImpl });
    const failed = expect(fetched).rejects.toEqual(expect.objectContaining({ name: UpstreamFetchError.name, upstream: "bangumi" }));
    await body.reading;
    await vi.advanceTimersByTimeAsync(DEFAULT_ATTEMPT_TIMEOUT_MS - 1);
    expect(body.signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(body.signals[0]?.aborted).toBe(true);
    await failed;
  });

  it("hands a caller that cancels mid-body its own reason, not an upstream failure", async () => {
    const caller = new AbortController();
    const reason = new Error("the edge gave up");
    const body = stalledBody();
    const fetched = fetchJson(SUBJECT, { fetchImpl: body.fetchImpl, signal: caller.signal });
    await body.reading;
    caller.abort(reason);
    await expect(fetched).rejects.toBe(reason);
  });
});
