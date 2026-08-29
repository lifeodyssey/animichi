import { describe, expect, it } from "vitest";
import { pointsByBangumiId } from "../src/api/work-points";
import { PREVIEW, PUBLISHED, fakeDb } from "./work-points.fixtures";

describe("pointsByBangumiId tiered ingest", () => {
  it("parks an uncovered work and returns its preview without starting the pipeline", async () => {
    const { db, previews, parked } = fakeDb();

    const result = await pointsByBangumiId(db, "115908");

    expect(result).toMatchObject({ rows: [PREVIEW], partial: true });
    expect(previews).toEqual(["115908"]);
    expect(parked).toEqual(["115908"]);
  });

  it("serves a genuine-empty marker without previewing or parking", async () => {
    const { db, previews, parked } = fakeDb({ guard: "empty" });
    const result = await pointsByBangumiId(db, "115908");
    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect([previews, parked]).toEqual([[], []]);
  });

  it("serves a recent-attempt marker without previewing or parking", async () => {
    const { db, previews, parked } = fakeDb({ guard: "recently_attempted" });
    const result = await pointsByBangumiId(db, "115908");
    expect(result.rows).toEqual([]);
    expect(result.partial).toBe(true);
    expect([previews, parked]).toEqual([[], []]);
  });

  it("serves a live-running marker without previewing or parking", async () => {
    const { db, previews, parked } = fakeDb({ guard: "in_progress" });
    const result = await pointsByBangumiId(db, "115908");
    expect(result).toMatchObject({ rows: [], partial: true });
    expect([previews, parked]).toEqual([[], []]);
  });
});

describe("pointsByBangumiId published semantics", () => {
  it("keeps the published-points path unchanged", async () => {
    const { db, previews, parked } = fakeDb({ rows: [PUBLISHED] });
    const result = await pointsByBangumiId(db, "115908");
    expect(result.rows.map((point) => point.id)).toEqual(["published-1"]);
    expect(result.synced_at).toBe("2026-07-17T00:00:00.000Z");
    expect(result.partial).toBeUndefined();
    expect([previews, parked]).toEqual([[], []]);
  });
});
