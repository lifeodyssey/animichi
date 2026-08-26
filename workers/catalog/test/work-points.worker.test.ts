import { describe, expect, it } from "vitest";
import { pointsByBangumiId } from "../src/api/work-points";
import type { IngestResult } from "../src/ingest/ingest-bangumi";
import { PREVIEW, PUBLISHED, fakeDb, waitUntilSpy } from "./work-points.fixtures";

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

});
