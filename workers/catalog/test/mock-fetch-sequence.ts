import type { FetchLike } from "../src/ingest/sources";

interface MockOptions {
  ok?: boolean;
  status?: number;
}

interface SequenceResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface SequenceFetch {
  fetch: FetchLike;
  callCount: () => number;
}

/** Build a mock FetchLike that records the URL and returns a canned JSON body. */
export function mockFetch(body: unknown, opts: MockOptions = {}): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve(cannedResponse(body, opts));
  };
  return { fetch, urls };
}

function cannedResponse(body: unknown, opts: MockOptions) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: () => Promise.resolve(body),
  };
}

/** Build a mock FetchLike serving canned responses in sequence, with optional headers. */
export function mockFetchSequence(responses: SequenceResponse[]): SequenceFetch {
  let calls = 0;
  const fetch: FetchLike = () => {
    const response = responses[calls];
    if (response === undefined) throw new Error(sequenceMissMessage(calls, responses.length));
    calls += 1;
    return Promise.resolve(sequenceResponse(response));
  };
  return { fetch, callCount: () => calls };
}

function sequenceMissMessage(calls: number, expected: number): string {
  return `fetch called ${String(calls + 1)} times, expected ${String(expected)}`;
}

function sequenceResponse(response: SequenceResponse) {
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    headers: { get: (name: string) => response.headers?.[name] ?? null },
    json: () => Promise.resolve(response.body),
  };
}

/**
 * Build a mock FetchLike that REJECTS every call — a transport-layer failure
 * (DNS/connection-refused/timeout), distinct from `mockFetchSequence`'s
 * resolved-but-bad-status responses. `fetchWithRetry` (src/ingest/sources.ts)
 * treats a rejected fetch() the same as a transient status: retried, then
 * (once the retry budget is exhausted) rethrown as UpstreamFetchError.
 */
export function mockFetchReject(error: Error): { fetch: FetchLike; callCount: () => number } {
  let calls = 0;
  const fetch: FetchLike = () => {
    calls += 1;
    return Promise.reject(error);
  };
  return { fetch, callCount: () => calls };
}

/** A fake clock: records requested waits and resolves instantly — no real timers. */
export function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}
