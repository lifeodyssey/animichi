import { describe, expect, it } from "vitest";
import {
  pointsByWorkId,
  type WorkPointsDb,
} from "../src/api/work-points";
import type {
  IngestClaim,
  IngestGuard,
  IngestResult,
} from "../src/ingest/orchestrator";
import type { PilgrimagePoint } from "../src/types";
import type { WorkPointRow } from "../src/api/search";

const PREVIEW: PilgrimagePoint = {
  id: "lite-1",
  name: "宇治橋",
  bangumi_id: "115908",
  screenshot_url: "https://image.anitabi.cn/lite-1.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
};

const PUBLISHED: WorkPointRow = {
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

interface Recorder {
  db: WorkPointsDb;
  previews: string[];
  claims: string[];
  ingests: string[];
  completed: string[];
}

function fakeDb(options: {
  rows?: WorkPointRow[];
  rowsSequence?: WorkPointRow[][];
  guard?: IngestGuard;
  claim?: IngestClaim;
  ingest?: Promise<IngestResult>;
} = {}): Recorder {
  const previews: string[] = [];
  const claims: string[] = [];
  const ingests: string[] = [];
  const completed: string[] = [];
  let guard = options.guard ?? "ready";
  const rowsSequence = [...(options.rowsSequence ?? [])];
  const db: WorkPointsDb = {
    pointsForWork: () => Promise.resolve(rowsSequence.shift() ?? options.rows ?? []),
    previewForWork: (workId) => {
      previews.push(workId);
      return Promise.resolve({ workId, points: [PREVIEW] });
    },
    ingestGuard: () => Promise.resolve(guard),
    claimIngest: (workId) => {
      claims.push(workId);
      const claim: IngestClaim = options.claim ?? (guard === "ready" ? "acquired" : guard);
      if (claim === "acquired") guard = "in_progress";
      return Promise.resolve(claim);
    },
    markDone: (workId) => {
      completed.push(workId);
      return Promise.resolve();
    },
    runClaimedIngest: (workId) => {
      ingests.push(workId);
      return options.ingest ?? Promise.resolve({ status: "ingested", version: 1, pointCount: 1 });
    },
  };
  return { db, previews, claims, ingests, completed };
}

function waitUntilSpy(): {
  waitUntil: (promise: Promise<unknown>) => void;
  scheduled: Promise<unknown>[];
} {
  const scheduled: Promise<unknown>[] = [];
  return { waitUntil: (promise) => void scheduled.push(promise), scheduled };
}

describe("pointsByWorkId tiered ingest", () => {
  it("returns a partial preview and schedules one ingest while the marker is in flight", async () => {
    let finish: (result: IngestResult) => void = () => undefined;
    const ingest = new Promise<IngestResult>((resolve) => (finish = resolve));
    const { db, previews, claims, ingests } = fakeDb({ ingest });
    const { waitUntil, scheduled } = waitUntilSpy();

    const [first, duplicate] = await Promise.all([
      pointsByWorkId(db, "115908", { waitUntil }),
      pointsByWorkId(db, "115908", { waitUntil }),
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
    const result = await pointsByWorkId(db, "115908", waitUntilSpy());
    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("serves a recent-attempt marker without previewing or re-ingesting", async () => {
    const { db, previews, claims, ingests } = fakeDb({ guard: "recently_attempted" });
    const result = await pointsByWorkId(db, "115908", waitUntilSpy());
    expect(result.rows).toEqual([]);
    expect(result.partial).toBe(true);
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("returns empty partial when it loses the claim before preview", async () => {
    const { db, previews, ingests } = fakeDb({ claim: "in_progress" });
    const result = await pointsByWorkId(db, "115908", waitUntilSpy());
    expect(result).toMatchObject({ rows: [], partial: true });
    expect([previews, ingests]).toEqual([[], []]);
  });
});

describe("pointsByWorkId completion semantics", () => {
  it("re-reads published rows after claiming and closes the no-op claim", async () => {
    const recorder = fakeDb({ rowsSequence: [[], [PUBLISHED]] });
    const result = await pointsByWorkId(recorder.db, "115908", waitUntilSpy());
    expect(result.rows.map((point) => point.id)).toEqual(["published-1"]);
    expect(recorder.completed).toEqual(["115908"]);
    expect([recorder.previews, recorder.ingests]).toEqual([[], []]);
  });

  it("keeps the published-points path unchanged", async () => {
    const { db, previews, claims, ingests } = fakeDb({ rows: [PUBLISHED] });
    const result = await pointsByWorkId(db, "115908", waitUntilSpy());
    expect(result.rows.map((point) => point.id)).toEqual(["published-1"]);
    expect(result.synced_at).toBe("2026-07-17T00:00:00.000Z");
    expect(result.partial).toBeUndefined();
    expect([previews, claims, ingests]).toEqual([[], [], []]);
  });

  it("runs the claimed ingest synchronously when waitUntil is absent", async () => {
    const { db, ingests } = fakeDb();
    const result = await pointsByWorkId(db, "115908");
    expect(ingests).toEqual(["115908"]);
    expect(result).toMatchObject({ rows: [PREVIEW], partial: true });
  });

  it("falls back to the held preview when synchronous ingest rejects", async () => {
    const ingest = Promise.reject(new Error("upstream unavailable"));
    void ingest.catch(() => undefined);
    const { db } = fakeDb({ ingest });
    await expect(pointsByWorkId(db, "115908")).resolves.toMatchObject({
      rows: [PREVIEW], partial: true,
    });
  });

  it("swallows background ingest rejection inside the waitUntil promise", async () => {
    const ingest = Promise.reject(new Error("background failure"));
    void ingest.catch(() => undefined);
    const { db } = fakeDb({ ingest });
    const { waitUntil, scheduled } = waitUntilSpy();
    await expect(pointsByWorkId(db, "115908", { waitUntil })).resolves.toMatchObject({
      rows: [PREVIEW], partial: true,
    });
    await expect(Promise.all(scheduled)).resolves.toEqual([undefined]);
  });
});
