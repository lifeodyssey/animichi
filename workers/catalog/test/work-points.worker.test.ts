import { describe, expect, it } from "vitest";
import {
  pointsByBangumiId,
  type WorkPointsPort,
} from "../src/api/work-points";
import type {
  IngestClaim,
  IngestGuard,
  IngestResult,
} from "../src/ingest/ingest-bangumi";
import type { Point } from "../src/types";
import type { PublishedPointRow } from "../src/application/list-points-for-bangumi";
import type { MissPreview } from "../src/api/preview";

const PREVIEW: Point = {
  id: "lite-1",
  name: "宇治橋",
  bangumi_id: "115908",
  screenshot_url: "https://image.anitabi.cn/lite-1.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
};

const PUBLISHED: PublishedPointRow = {
  id: "published-1",
  name: "宇治橋",
  name_cn: null,
  bangumi_id: "115908",
  episode: 1,
  time_seconds: 120,
  image: "published.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
  title: "響け！ユーフォニアム",
  title_cn: null,
  cover_url: null,
  synced_at: "2026-07-17T00:00:00.000Z",
};

interface FakeDbOptions {
  rows?: PublishedPointRow[];
  rowsSequence?: PublishedPointRow[][];
  guard?: IngestGuard;
  claim?: IngestClaim;
  ingest?: Promise<IngestResult>;
}

interface RecorderState extends FakeDbOptions {
  previews: string[];
  claims: string[];
  ingests: string[];
  completed: string[];
  guard: IngestGuard;
  rowsSequence: PublishedPointRow[][];
}

function fakeDb(options: FakeDbOptions = {}) {
  const state = recorderState(options);
  return { db: fakeDbMethods(state), ...state };
}

function recorderState(options: FakeDbOptions): RecorderState {
  const sequences = [...(options.rowsSequence ?? [])];
  return { ...options, previews: [], claims: [], ingests: [], completed: [], guard: options.guard ?? "ready", rowsSequence: sequences };
}

function fakeDbMethods(state: RecorderState): WorkPointsPort {
  return {
    pointsForBangumi: () => Promise.resolve(state.rowsSequence.shift() ?? state.rows ?? []),
    previewForWork: (bangumiId) => previewWork(state, bangumiId),
    ingest: {
      guard: () => Promise.resolve(state.guard),
      claim: (bangumiId) => claimWork(state, bangumiId),
      markDone: (bangumiId) => markWorkDone(state, bangumiId),
      runClaimed: (bangumiId) => runIngestWork(state, bangumiId),
    },
  };
}

function previewWork(state: RecorderState, bangumiId: string): Promise<MissPreview> {
  state.previews.push(bangumiId);
  return Promise.resolve({ bangumiId, points: [PREVIEW] });
}

function claimWork(state: RecorderState, bangumiId: string): Promise<IngestClaim> {
  state.claims.push(bangumiId);
  const claim: IngestClaim = state.claim ?? (state.guard === "ready" ? "acquired" : state.guard);
  if (claim === "acquired") state.guard = "in_progress";
  return Promise.resolve(claim);
}

function markWorkDone(state: RecorderState, bangumiId: string): Promise<void> {
  state.completed.push(bangumiId);
  return Promise.resolve();
}

function runIngestWork(state: RecorderState, bangumiId: string): Promise<IngestResult> {
  state.ingests.push(bangumiId);
  return state.ingest ?? Promise.resolve({ status: "ingested", version: 1, pointCount: 1 });
}

function waitUntilSpy(): {
  waitUntil: (promise: Promise<unknown>) => void;
  scheduled: Promise<unknown>[];
} {
  const scheduled: Promise<unknown>[] = [];
  return { waitUntil: (promise) => void scheduled.push(promise), scheduled };
}

describe("pointsByBangumiId tiered ingest", () => {
  it("returns a partial preview and schedules one ingest while the marker is in flight", async () => {
    let finish: (result: IngestResult) => void = () => undefined;
    const ingest = new Promise<IngestResult>((resolve) => (finish = resolve));
    const { db, previews, claims, ingests } = fakeDb({ ingest });
    const { waitUntil, scheduled } = waitUntilSpy();

    const [first, duplicate] = await Promise.all([
      pointsByBangumiId(db, "115908", { waitUntil }),
      pointsByBangumiId(db, "115908", { waitUntil }),
    ]);

    expect(first).toMatchObject({ rows: [PREVIEW], partial: true });
    expect(duplicate).toMatchObject({ rows: [], partial: true });
    expect(previews).toEqual(["115908"]);
    expect(claims).toEqual(["115908", "115908"]);
    expect(ingests).toEqual(["115908"]);
    expect(scheduled).toHaveLength(1);
    finish({ status: "ingested", version: 1, pointCount: 1 });
    await Promise.all(scheduled);
  });

  it("serves a genuine-empty marker without previewing or re-ingesting", async () => {
    const { db, previews, claims, ingests } = fakeDb({ guard: "empty" });
    const result = await pointsByBangumiId(db, "115908", waitUntilSpy());
    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("serves a recent-attempt marker without previewing or re-ingesting", async () => {
    const { db, previews, claims, ingests } = fakeDb({ guard: "recently_attempted" });
    const result = await pointsByBangumiId(db, "115908", waitUntilSpy());
    expect(result.rows).toEqual([]);
    expect(result.partial).toBe(true);
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("returns empty partial when it loses the claim before preview", async () => {
    const { db, previews, ingests } = fakeDb({ claim: "in_progress" });
    const result = await pointsByBangumiId(db, "115908", waitUntilSpy());
    expect(result).toMatchObject({ rows: [], partial: true });
    expect([previews, ingests]).toEqual([[], []]);
  });
});

describe("pointsByBangumiId completion semantics", () => {
  it("re-reads published rows after claiming and closes the no-op claim", async () => {
    const recorder = fakeDb({ rowsSequence: [[], [PUBLISHED]] });
    const result = await pointsByBangumiId(recorder.db, "115908", waitUntilSpy());
    expect(result.rows.map((point) => point.id)).toEqual(["published-1"]);
    expect(recorder.completed).toEqual(["115908"]);
    expect([recorder.previews, recorder.ingests]).toEqual([[], []]);
  });

  it("keeps the published-points path unchanged", async () => {
    const { db, previews, claims, ingests } = fakeDb({ rows: [PUBLISHED] });
    const result = await pointsByBangumiId(db, "115908", waitUntilSpy());
    expect(result.rows.map((point) => point.id)).toEqual(["published-1"]);
    expect(result.synced_at).toBe("2026-07-17T00:00:00.000Z");
    expect(result.partial).toBeUndefined();
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("runs the claimed ingest synchronously when waitUntil is absent", async () => {
    const { db, ingests } = fakeDb();
    const result = await pointsByBangumiId(db, "115908");
    expect(ingests).toEqual(["115908"]);
    expect(result).toMatchObject({ rows: [PREVIEW], partial: true });
  });

  it("falls back to the held preview when synchronous ingest rejects", async () => {
    const ingest = Promise.reject(new Error("upstream unavailable"));
    void ingest.catch(() => undefined);
    const { db } = fakeDb({ ingest });
    await expect(pointsByBangumiId(db, "115908")).resolves.toMatchObject({ rows: [PREVIEW], partial: true });
  });

  it("returns the empty result when synchronous ingest finds no points", async () => {
    const { db } = fakeDb({ ingest: Promise.resolve({ status: "empty", reason: "no points" }) });
    await expect(pointsByBangumiId(db, "115908")).resolves.toMatchObject({ rows: [] });
  });

  it("swallows background ingest rejection inside the waitUntil promise", async () => {
    const ingest = Promise.reject(new Error("background failure"));
    void ingest.catch(() => undefined);
    const { db } = fakeDb({ ingest });
    const { waitUntil, scheduled } = waitUntilSpy();
    await expect(pointsByBangumiId(db, "115908", { waitUntil })).resolves.toMatchObject({
      rows: [PREVIEW], partial: true,
    });
    await expect(Promise.all(scheduled)).resolves.toEqual([undefined]);
  });
});
