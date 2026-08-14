import type { SavedRoute } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import { fakeDb, fakeDbFrom, type FakeSavedRouteRow } from "./in-memory-routes-db";
import type { UsersDb } from "../src/db/client";

const ID = "00000000-0000-4000-8000-000000000009";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: [],
    status: "saved", saved_at: null, updated_at: NOW, ...overrides,
  };
}

describe("NeonSavedRouteRepo over the raw executor", () => {
  it("reads owned saved routes through listOwned", async () => {
    const repo = new NeonSavedRouteRepo(fakeDb([row()]).db);
    expect((await repo.listOwned("user-a")).map((route) => route.id)).toEqual([ID]);
  });

  it("creates a saved route through the action and returns the normalized row", async () => {
    const repo: SavedRouteStore = new NeonSavedRouteStore(fakeDb().db);
    const route = await saveSavedRoute(repo, "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW);
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(route.saved_at).toBe(NOW);
  });
});

describe("NeonSavedRouteRepo defensive normalization", () => {
  const rawDb = (row: Record<string, unknown>): UsersDb =>
    fakeDbFrom(() => [row]);

  it("normalizes malformed row fields instead of crashing", async () => {
    const repo = new NeonSavedRouteRepo(
      rawDb({
        id: "r1",
        title: 42,
        status: "saved",
        point_ids: [1, "p2"],
        saved_at: new Date("2026-07-13T04:00:00.000Z"),
        updated_at: "2026-07-13T04:00:00.000Z",
      }),
    );
    const [first] = (await repo.listOwned("user-a")) as [
      SavedRoute, ...SavedRoute[],
    ];
    expect(first).toMatchObject({ id: "r1", title: "", point_ids: [] });
    expect(first.saved_at).toBe("2026-07-13T04:00:00.000Z");
  });

  it("rejects rows with an unparseable timestamp", async () => {
    const repo = new NeonSavedRouteRepo(rawDb({ id: "r2", title: "x", status: "saved", updated_at: 12345 }));
    await expect(repo.listOwned("user-a")).rejects.toThrow("invalid timestamp row");
  });

});

describe("findOwner defensive cases (USERS-1 coverage)", () => {
  const rawDb = (rows: Record<string, unknown>[]): UsersDb =>
    fakeDbFrom(() => rows);

  it("returns undefined when no row matches", async () => {
    const repo = new NeonSavedRouteStore(rawDb([]));
    await expect(repo.findOwner("r-none")).resolves.toBeUndefined();
  });

  it("rejects a non-record row", async () => {
    const repo = new NeonSavedRouteStore(rawDb([42 as unknown as Record<string, unknown>]));
    await expect(repo.findOwner("r-x")).rejects.toThrow("invalid saved route row");
  });

  it("coerces a non-string user_id to null (unclaimed)", async () => {
    const repo = new NeonSavedRouteStore(rawDb([{ id: "r4", user_id: 12345, saved_at: null }]));
    await expect(repo.findOwner("r4")).resolves.toEqual({ userId: null, savedAt: null });
  });

  it("throws on an unparseable saved_at", async () => {
    const repo = new NeonSavedRouteStore(rawDb([{ id: "r5", user_id: "user-a", saved_at: 12345 }]));
    await expect(repo.findOwner("r5")).rejects.toThrow("invalid timestamp row");
  });
});
