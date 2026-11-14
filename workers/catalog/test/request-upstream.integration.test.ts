import pg from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { DEFAULT_ATTEMPT_TIMEOUT_MS } from "../src/ingest/retry";
import { catalogRequest } from "./catalog-request";
import { abortTimeoutsOnFakeClock } from "./fakes/abort-timeout";
import { unanswered } from "./fakes/unanswered-request";
import { deferred } from "./deferred";
import { databaseDescribe, directPoolConfig, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";

// `src/index.ts` exports a `WorkerEntrypoint`; plain Node has no workerd module to load it from.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

/**
 * SUT: the request path's upstream calls — `pointsByBangumiId`'s anitabi `/lite`
 * preview through the egress service, and the Bangumi searches behind `resolve`
 * and `search` — driven through the whole Hono app against the suite database.
 *
 * The upstream is a stub that answers scripted statuses and then never answers,
 * rejecting only when its own request signal aborts, as `fetch` does. Time is
 * vitest's fake clock, with `AbortSignal.timeout` rebuilt on it (`./fakes/abort-timeout`).
 */

let pool: pg.Pool;

/** An egress answer with the service's relayed marker. */
function relayed(status: number): Response {
  return new Response(null, { status, headers: { "x-egress-response": "relayed-upstream" } });
}

/** The upstream: answers `statuses` in order, then never answers. Records each call's signal. */
function scriptedUpstream(statuses: readonly number[]) {
  const signals: AbortSignal[] = [];
  const arrivals = [deferred(), deferred(), deferred(), deferred()];
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
    const signal = init?.signal ?? AbortSignal.abort(new Error("the upstream call carried no signal"));
    arrivals[signals.length]?.settle();
    signals.push(signal);
    const status = statuses.at(signals.length - 1);
    return status === undefined ? unanswered(signal) : Promise.resolve(relayed(status));
  });
  const arrival = (n: number) => arrivals[n]?.promise ?? Promise.reject(new Error(`no arrival ${String(n)} is tracked`));
  return { signals, called: async (n: number) => { await arrival(n); return signals[n]; } };
}

/**
 * The fake clock, with `AbortSignal.timeout` rebuilt on it. Returns when each
 * timeout was armed: an attempt arms its own before it signs and sends, so that,
 * not the request's arrival at the stub, is when the attempt began.
 */
function fakeClock(): number[] {
  vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date"] });
  return abortTimeoutsOnFakeClock();
}

function post(path: string, payload: unknown, signal?: AbortSignal): Promise<Response> {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal };
  return catalogRequest(path, init, { ENVIRONMENT: "test", DATABASE_URL: planeDatabaseUrl() });
}

function pointsPreview(bangumiId: string): Promise<Response> {
  return post("/catalog/points-by-bangumi-id", { bangumi_id: bangumiId });
}

beforeAll(async () => {
  pool = new pg.Pool(directPoolConfig(planeDatabaseUrl()));
  await truncateCatalogPool(pool);
}, 120_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.end();
});

databaseDescribe("pointsByBangumiId preview: an upstream that never answers", () => {
  it("aborts the call at the attempt timeout and starts no retry the deadline cannot hold", async () => {
    const armedAt = fakeClock();
    const upstream = scriptedUpstream([503]);
    const response = pointsPreview("460400");
    await upstream.called(0);
    await vi.advanceTimersByTimeAsync(400);
    const hung = await upstream.called(1);
    const timesOutAt = (armedAt[1] ?? Number.NaN) + DEFAULT_ATTEMPT_TIMEOUT_MS;
    await vi.advanceTimersByTimeAsync(timesOutAt - Date.now() - 1);
    expect(hung?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung?.aborted).toBe(true);
    expect((await response).status).toBe(502);
    expect(upstream.signals).toHaveLength(2);
  });
});

/**
 * Every procedure that reaches upstream on the request path. An outage would
 * answer 502 (search, pointsByBangumiId) or `upstream_unavailable` (resolve); a
 * cancel answers oRPC's generic 500 to a caller that is no longer there.
 */
const CANCELLABLE = [
  ["/catalog/points-by-bangumi-id", { bangumi_id: "460401" }],
  ["/catalog/resolve", { query: "取消された題名" }],
  ["/catalog/search", { query: "取消された題名" }],
] as const;

databaseDescribe("request-path upstream calls: a caller that cancels", () => {
  it.each(CANCELLABLE)("%s aborts its upstream call in flight with the caller's own reason", async (path, payload) => {
    const upstream = scriptedUpstream([]);
    const caller = new AbortController();
    const reason = new Error("the edge gave up");
    const response = post(path, payload, caller.signal);
    const inFlight = await upstream.called(0);
    caller.abort(reason);
    expect(inFlight?.reason).toBe(reason);
    expect((await response).status).toBe(500);
    expect(upstream.signals).toHaveLength(1);
  });
});
