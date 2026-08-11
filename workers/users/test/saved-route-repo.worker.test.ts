import type {
  ListSavedRoutesResult,
  SavedRoute,
} from "@animichi/contract";
import { describe, expect, it, vi } from "vitest";
import { NeonSavedRouteRepo } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import {
  claimSavedRoutes,
  listSavedRoutes,
} from "../src/api/routes";
import type { SavedRouteRepo } from "../src/domain/ports";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";
import type { DbExecutor } from "../src/db/client";

const ID = "00000000-0000-4000-8000-000000000009";
const SESSION = "anonymous-session";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, claim_session_id: null, user_id: "user-a", title: "Tokyo", point_ids: [],
    status: "saved", saved_at: null, updated_at: NOW, ...overrides,
  };
}

function stubRepo(): SavedRouteRepo {
  return {
    listSavedRoutes: vi.fn().mockResolvedValue({ saved_routes: [] } satisfies ListSavedRoutesResult),
    claimSavedRoutes: vi.fn().mockResolvedValue({ claimed_count: 0 }),
  };
}

describe("handlers delegate to the SavedRouteRepo port", () => {
  it("listSavedRoutes forwards the user id", async () => {
    const repo = stubRepo();
    expect(await listSavedRoutes(repo, "user-a")).toEqual({ saved_routes: [] });
    expect(repo.listSavedRoutes).toHaveBeenCalledExactlyOnceWith("user-a");
  });

  it("claimSavedRoutes forwards user id and input", async () => {
    const repo = stubRepo();
    expect(await claimSavedRoutes(repo, "user-a", { session_id: SESSION })).toEqual({ claimed_count: 0 });
    expect(repo.claimSavedRoutes).toHaveBeenCalledExactlyOnceWith("user-a", { session_id: SESSION });
  });
});

describe("NeonSavedRouteRepo over the raw executor", () => {
  it("lists owned saved routes newest update first", async () => {
    const older = row({ id: "00000000-0000-4000-8000-000000000001", updated_at: "2026-07-12T00:00:00Z" });
    const newer = row({ id: "00000000-0000-4000-8000-000000000002", updated_at: "2026-07-13T00:00:00Z" });
    const repo = new NeonSavedRouteRepo(fakeDb([older, newer]).db);
    expect((await repo.listSavedRoutes("user-a")).saved_routes.map((route) => route.id)).toEqual([newer.id, older.id]);
  });

  it("creates a saved route through the action and returns the normalized row", async () => {
    const repo: SavedRouteStore = new NeonSavedRouteRepo(fakeDb().db);
    const route = await saveSavedRoute(repo, "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW);
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(route.saved_at).toBe(NOW);
  });

  it("claims only still-anonymous rows of the session", async () => {
    const store = fakeDb([
      row({ claim_session_id: SESSION, user_id: null }),
      row({ id: "00000000-0000-4000-8000-000000000002", claim_session_id: SESSION, user_id: "user-b" }),
    ]);
    const repo = new NeonSavedRouteRepo(store.db);
    expect(await repo.claimSavedRoutes("user-a", { session_id: SESSION })).toEqual({ claimed_count: 1 });
    expect(store.rows.map((item) => item.user_id)).toEqual(["user-a", "user-b"]);
  });

  it("deletes only the row still owned by the user", async () => {
    const other = row({ id: "00000000-0000-4000-8000-000000000002", user_id: "user-b" });
    const store = fakeDb([row(), other]);
    const repo = new NeonSavedRouteRepo(store.db);
    expect(await repo.deleteOwned("user-a", ID)).toEqual({ kind: "deleted" });
    expect(store.rows).toEqual([other]);
    expect(await repo.deleteOwned("user-a", ID)).toEqual({ kind: "missing" });
  });
});

describe("NeonSavedRouteRepo defensive normalization", () => {
  const rawDb = (row: Record<string, unknown>): DbExecutor => ({
    execute: () => Promise.resolve({ rows: [row] }),
  });

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
    const [first] = (await repo.listSavedRoutes("user-a")).saved_routes as [
      SavedRoute, ...SavedRoute[],
    ];
    expect(first).toMatchObject({ id: "r1", title: "", point_ids: [] });
    expect(first.saved_at).toBe("2026-07-13T04:00:00.000Z");
  });

  it("rejects rows with an unparseable timestamp", async () => {
    const repo = new NeonSavedRouteRepo(rawDb({ id: "r2", title: "x", status: "saved", updated_at: 12345 }));
    await expect(repo.listSavedRoutes("user-a")).rejects.toThrow("invalid timestamp row");
  });
});

describe("findOwner defensive cases (USERS-1 coverage)", () => {
  const rawDb = (rows: Record<string, unknown>[]): DbExecutor => ({
    execute: () => Promise.resolve({ rows }),
  });

  it("returns undefined when no row matches", async () => {
    const repo = new NeonSavedRouteRepo(rawDb([]));
    await expect(repo.findOwner("r-none")).resolves.toBeUndefined();
  });

  it("rejects a non-record row", async () => {
    const repo = new NeonSavedRouteRepo(rawDb([42 as unknown as Record<string, unknown>]));
    await expect(repo.findOwner("r-x")).rejects.toThrow("invalid saved route row");
  });

  it("coerces a non-string user_id to null (unclaimed)", async () => {
    const repo = new NeonSavedRouteRepo(rawDb([{ id: "r4", user_id: 12345, saved_at: null }]));
    await expect(repo.findOwner("r4")).resolves.toEqual({ userId: null, savedAt: null });
  });

  it("throws on an unparseable saved_at", async () => {
    const repo = new NeonSavedRouteRepo(rawDb([{ id: "r5", user_id: "user-a", saved_at: 12345 }]));
    await expect(repo.findOwner("r5")).rejects.toThrow("invalid timestamp row");
  });
});
