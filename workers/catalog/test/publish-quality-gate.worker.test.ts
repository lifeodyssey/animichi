/**
 * Publish-stage quality gate tests (X15 #285, the four card ACs).
 *
 * Drives publishSnapshot with a fake db + in-memory store so each AC is
 * proven at the boundary where the catalog decides what becomes public:
 * the published points object contains only gated rows, and the quality
 * report reaches the injected alert seam.
 */
import { describe, expect, it } from "vitest";
import { publishSnapshot, type PublishInput } from "../src/publish/snapshot";
import type { ObjectStore } from "../src/publish/object-store";
import type { ExportedSpotRow } from "../src/publish/candidate-export";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { entryText, inMemoryObjectStore } from "./fakes/in-memory-object-store";
import { KYOTO, NORTH_24_5M, driftRecorder, spotRow } from "./spot-quality.fixtures";

const FIRST_PUBLISH: PublishInput = { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" };
const SECOND_PUBLISH: PublishInput = { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" };

/** n spots for w1, >100 m apart along the latitude axis, so dedupe never fires. */
function spreadRows(count: number): ExportedSpotRow[] {
  return Array.from({ length: count }, (_item, index) =>
    spotRow({ id: "p-" + String(index).padStart(2, "0"), latitude: 35 + index * 0.001 }));
}

async function publishedSpotIds(store: ObjectStore, snapshotId: string): Promise<string[]> {
  const entry = await store.get("snapshots/" + snapshotId + "/data/points.json");
  const rows = JSON.parse(entryText(entry?.body ?? new ArrayBuffer(0))) as { id: string }[];
  return rows.map((row) => row.id);
}

describe("publish quality gate — coordinate rejection AC", () => {
  it("rejects invalid coordinates before they enter the published snapshot", async () => {
    const { store } = inMemoryObjectStore();
    const recorder = driftRecorder();
    const rows = [
      spotRow({ id: "p-good", latitude: KYOTO.latitude, longitude: KYOTO.longitude }),
      spotRow({ id: "p-null-island", latitude: 0, longitude: 0 }),
      spotRow({ id: "p-over-range", latitude: 91, longitude: 139 }),
    ];
    const db = fakeCatalogDb({ points: rows });
    const result = await publishSnapshot({ db, store, alerts: recorder.alerts }, FIRST_PUBLISH);
    expect(result.status).toBe("published");
    expect(await publishedSpotIds(store, "snap-daily-1")).toEqual(["p-good"]);
    expect(recorder.reports[0]?.rejectedSpots).toEqual([
      { spotId: "p-null-island", bangumiId: "w1", reason: "unpublishable-coordinates" },
      { spotId: "p-over-range", bangumiId: "w1", reason: "unpublishable-coordinates" },
    ]);
  });
});

describe("publish quality gate — duplicate merge AC", () => {
  it("merges same-episode spots within 25 m so the snapshot shows one card", async () => {
    const { store } = inMemoryObjectStore();
    const recorder = driftRecorder();
    const rows = [
      spotRow({ id: "p-kept", latitude: 35, longitude: 139, episode: 3 }),
      spotRow({ id: "p-near-dup", latitude: NORTH_24_5M.latitude, longitude: 139, episode: 3 }),
      spotRow({ id: "p-other-episode", latitude: 35, longitude: 139, episode: 4 }),
    ];
    const db = fakeCatalogDb({ points: rows });
    const result = await publishSnapshot({ db, store, alerts: recorder.alerts }, FIRST_PUBLISH);
    expect(result.status).toBe("published");
    expect(await publishedSpotIds(store, "snap-daily-1")).toEqual(["p-kept", "p-other-episode"]);
    expect(recorder.reports[0]?.duplicateMerges).toEqual([
      { keptSpotId: "p-kept", mergedSpotIds: ["p-near-dup"] },
    ]);
  });
});

describe("publish quality gate — zero spots AC", () => {
  it("publishes an anime with zero spots uneventfully, with an all-clear report", async () => {
    const { store } = inMemoryObjectStore();
    const recorder = driftRecorder();
    const db = fakeCatalogDb({ bangumi: [{ id: "w1" }], points: [] });
    const result = await publishSnapshot({ db, store, alerts: recorder.alerts }, FIRST_PUBLISH);
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.snapshot.counts.points).toBe(0);
    expect(await publishedSpotIds(store, "snap-daily-1")).toEqual([]);
    expect(recorder.reports).toEqual([
      { rejectedSpots: [], duplicateMerges: [], spotCountDrifts: [] },
    ]);
  });
});

describe("publish quality gate — drift alert AC", () => {
  it("alerts a ±30% day-over-day drift against the last publish instead of staying silent", async () => {
    const { store } = inMemoryObjectStore();
    const recorder = driftRecorder();
    await publishSnapshot(
      { db: fakeCatalogDb({ points: spreadRows(10) }), store, alerts: recorder.alerts }, FIRST_PUBLISH,
    );
    const result = await publishSnapshot(
      { db: fakeCatalogDb({ points: spreadRows(3) }), store, alerts: recorder.alerts }, SECOND_PUBLISH,
    );
    expect(result.status).toBe("published");
    expect(recorder.reports[0]?.spotCountDrifts).toEqual([]);
    expect(recorder.reports[1]?.spotCountDrifts).toEqual([
      { bangumiId: "w1", previousCount: 10, currentCount: 3, driftRatio: -0.7 },
    ]);
  });

  it("does not re-alert when the next publish repeats the same spot counts", async () => {
    const { store } = inMemoryObjectStore();
    const recorder = driftRecorder();
    await publishSnapshot(
      { db: fakeCatalogDb({ points: spreadRows(10) }), store, alerts: recorder.alerts }, FIRST_PUBLISH,
    );
    await publishSnapshot(
      { db: fakeCatalogDb({ points: spreadRows(10) }), store, alerts: recorder.alerts }, SECOND_PUBLISH,
    );
    expect(recorder.reports).toHaveLength(2);
    expect(recorder.reports[1]?.spotCountDrifts).toEqual([]);
  });
});
