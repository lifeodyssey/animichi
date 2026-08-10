import { describe, expect, it } from "vitest";
import {
  DEFAULT_INGEST_TTL,
  IngestBangumi,
  type IngestPublisher,
  type IngestSource,
  type IngestStore,
} from "../src/ingest/ingest-bangumi";
import { UpstreamFetchError, UpstreamNotFoundError, type AnitabiPoint } from "../src/ingest/sources";

const SUBJECT = { id: 1, name: "らき☆すた" };
const POINTS: AnitabiPoint[] = [{ id: "o-washinomiya", name: "鷲宮神社" }];

interface Recorder {
  calls: string[];
  failed: { bangumiId: string; errorCode: string; ttlSeconds: number }[];
  publishes: number;
  done: number;
}

function recorder(): Recorder {
  return { calls: [], failed: [], publishes: 0, done: 0 };
}

function mark(rec: Recorder, entry: string): Promise<void> { rec.calls.push(entry); return Promise.resolve(); }

/** Default store: first acquire wins the claim, completion releases it. */
function makeStore(rec: Recorder): IngestStore {
  let held = false;
  return {
    acquire: (id) => {
      rec.calls.push(`acquire:${id}`);
      if (held) return Promise.resolve(false);
      held = true;
      return Promise.resolve(true);
    },
    guard: () => Promise.resolve(held ? "in_progress" : "ready"),
    markDone: (id) => {
      rec.calls.push(`done:${id}`);
      rec.done++;
      held = false;
      return Promise.resolve();
    },
    markFailed: (id, opts) => {
      rec.failed.push({ bangumiId: id, errorCode: opts.errorCode, ttlSeconds: opts.ttlSeconds });
      return Promise.resolve();
    },
    saveRawBangumi: (id) => mark(rec, `save:bangumi:${id}`),
    saveRawAnitabi: (id) => mark(rec, `save:anitabi:${id}`),
  };
}

function makeSource(fetchPoints?: () => Promise<AnitabiPoint[]>): IngestSource {
  return {
    fetchBangumi: () => Promise.resolve(SUBJECT),
    fetchPoints: () => (fetchPoints ? fetchPoints() : Promise.resolve(POINTS)),
  };
}

function makePublisher(rec: Recorder): IngestPublisher {
  let version = 0;
  return {
    publish: (id) => {
      rec.calls.push(`publish:${id}`);
      rec.publishes++;
      version++;
      return Promise.resolve({ version, pointCount: POINTS.length });
    },
  };
}

describe("IngestBangumi claim uniqueness (singleflight)", () => {
  it("lets exactly one concurrent caller win and run the pipeline", async () => {
    const rec = recorder();
    const gate = deferred();
    const source: IngestSource = { fetchBangumi: () => Promise.resolve(SUBJECT), fetchPoints: () => gate.promise.then(() => POINTS) };
    const ingest = new IngestBangumi(source, makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    const winner = ingest.ingest("10380");
    const loser = await ingest.ingest("10380");
    gate.resolve();
    expect(await winner).toEqual({ status: "ingested", version: 1, pointCount: 1 });
    expect(loser.status).toBe("in_progress");
    expect(rec.publishes).toBe(1);
  });
});

describe("IngestBangumi claim pass-through", () => {
  it("passes a cached empty marker through without fetching or publishing", async () => {
    const rec = recorder();
    const store: IngestStore = {
      ...makeStore(rec), acquire: () => Promise.resolve(false), guard: () => Promise.resolve("empty"),
    };
    const ingest = new IngestBangumi(makeSource(neverFetch), store, makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).resolves.toEqual({ status: "empty", reason: "no points" });
    expect(rec.publishes).toBe(0);
    expect(rec.calls).toEqual([]);
  });
  it("reports a caller that loses the claim race as in_progress, doing no work", async () => {
    const rec = recorder();
    const store: IngestStore = {
      ...makeStore(rec),
      acquire: (id) => {
        rec.calls.push(`acquire:${id}`);
        return Promise.resolve(false);
      },
      guard: () => Promise.resolve("in_progress"),
    };
    const ingest = new IngestBangumi(makeSource(neverFetch), store, makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).resolves.toEqual({ status: "in_progress" });
    expect(rec.publishes).toBe(0);
    expect(rec.calls).toEqual(["acquire:10380"]);
  });
});

describe("IngestBangumi negative cache", () => {
  it("parks a confirmed-empty upstream behind the empty TTL", async () => {
    const rec = recorder();
    const ingest = new IngestBangumi(makeSource(() => Promise.resolve([])), makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).resolves.toEqual({ status: "empty", reason: "no points" });
    expect(rec.failed).toEqual([{ bangumiId: "10380", errorCode: "not_found", ttlSeconds: 7 * 24 * 60 * 60 }]);
    expect(rec.publishes).toBe(0);
  });
  it("parks an upstream 404 as empty, not an outage", async () => {
    const rec = recorder();
    const source: IngestSource = {
      fetchBangumi: () => Promise.reject(new UpstreamNotFoundError("https://api.bgm.tv/v0/subjects/10380")),
      fetchPoints: () => Promise.resolve(POINTS),
    };
    const ingest = new IngestBangumi(source, makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).resolves.toMatchObject({ status: "empty" });
    expect(rec.failed[0]?.errorCode).toBe("not_found");
    expect(rec.publishes).toBe(0);
  });
  it("parks an internal failure behind the short failure TTL", async () => {
    const rec = recorder();
    const ingest = new IngestBangumi(makeSource(() => { throw new Error("enrich exploded"); }), makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    const result = await ingest.ingest("10380");
    expect(result).toMatchObject({ status: "failed" });
    expect(rec.failed).toEqual([{ bangumiId: "10380", errorCode: "ingest_error", ttlSeconds: 60 * 60 }]);
  });
  it("rethrows transport failures as a defined 502 after parking failureSeconds", async () => {
    const rec = recorder();
    const source: IngestSource = {
      fetchBangumi: () => Promise.resolve(SUBJECT),
      fetchPoints: () => Promise.reject(new UpstreamFetchError("https://api.anitabi.cn/bangumi/10380", "anitabi")),
    };
    const ingest = new IngestBangumi(source, makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE", defined: true, status: 502, data: { upstream: "anitabi" },
    });
    expect(rec.failed[0]?.errorCode).toBe("ingest_error");
  });
});

describe("IngestBangumi atomic publish ordering", () => {
  it("saves raw payloads before publishing, then completes", async () => {
    const rec = recorder();
    const ingest = new IngestBangumi(makeSource(), makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    const result = await ingest.ingest("10380");
    expect(result).toEqual({ status: "ingested", version: 1, pointCount: 1 });
    expect(rec.calls).toEqual([
      "acquire:10380",
      "save:bangumi:10380",
      "save:anitabi:10380",
      "publish:10380",
      "done:10380",
    ]);
  });
});

describe("IngestBangumi crash recovery + idempotent replay", () => {
  it("completes a claim that was left running by a crashed peer", async () => {
    const rec = recorder();
    const store: IngestStore = {
      ...makeStore(rec), acquire: () => Promise.resolve(true), guard: () => Promise.resolve("in_progress"),
    };
    const ingest = new IngestBangumi(makeSource(), store, makePublisher(rec), DEFAULT_INGEST_TTL);
    await expect(ingest.ingest("10380")).resolves.toMatchObject({ status: "ingested" });
    expect(rec.done).toBe(1);
  });
  it("replays idempotently: each re-ingest runs one atomic pipeline", async () => {
    const rec = recorder();
    const ingest = new IngestBangumi(makeSource(), makeStore(rec), makePublisher(rec), DEFAULT_INGEST_TTL);
    await ingest.ingest("10380");
    await ingest.ingest("10380");
    expect(rec.publishes).toBe(2);
    expect(rec.done).toBe(2);
  });
});

function neverFetch(): Promise<AnitabiPoint[]> { throw new Error("must not fetch"); }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
