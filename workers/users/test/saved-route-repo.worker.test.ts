import type {
  ListRoutesResult,
  SaveRouteInput,
  UserRoute,
} from "@animichi/contract";
import { describe, expect, it, vi } from "vitest";
import { NeonSavedRouteRepo } from "../src/adapters/neon-saved-route-repo";
import {
  claimRoutes,
  deleteRoute,
  listRoutes,
  saveRoute,
} from "../src/api/routes";
import type { SavedRouteRepo } from "../src/domain/ports";
import { fakeDb, type FakeRouteRow } from "./in-memory-routes-db";
import type { DbExecutor } from "../src/db/client";

const ID = "00000000-0000-4000-8000-000000000009";
const SESSION = "anonymous-session";

const OWNED: UserRoute = {
  id: ID, title: "Tokyo", status: "saved", point_ids: [],
  saved_at: "2026-07-13T04:00:00.000Z", updated_at: "2026-07-13T04:00:00.000Z",
};

function row(overrides: Partial<FakeRouteRow> = {}): FakeRouteRow {
  return {
    id: ID, session_id: null, user_id: "user-a", title: "Tokyo", point_ids: [],
    status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

function stubRepo(): SavedRouteRepo {
  return {
    listRoutes: vi.fn().mockResolvedValue({ routes: [] } satisfies ListRoutesResult),
    saveRoute: vi.fn().mockResolvedValue(OWNED),
    deleteRoute: vi.fn().mockResolvedValue({ deleted: true }),
    claimRoutes: vi.fn().mockResolvedValue({ claimed_count: 0 }),
  };
}

describe("handlers delegate to the SavedRouteRepo port", () => {
  it("listRoutes forwards the user id", async () => {
    const repo = stubRepo();
    expect(await listRoutes(repo, "user-a")).toEqual({ routes: [] });
    expect(repo.listRoutes).toHaveBeenCalledExactlyOnceWith("user-a");
  });

  it("saveRoute forwards user id and input", async () => {
    const repo = stubRepo();
    const input: SaveRouteInput = { title: "Tokyo", point_ids: [], status: "saved" };
    expect(await saveRoute(repo, "user-a", input)).toEqual(OWNED);
    expect(repo.saveRoute).toHaveBeenCalledExactlyOnceWith("user-a", input);
  });

  it("deleteRoute forwards user id and input", async () => {
    const repo = stubRepo();
    expect(await deleteRoute(repo, "user-a", { id: ID })).toEqual({ deleted: true });
    expect(repo.deleteRoute).toHaveBeenCalledExactlyOnceWith("user-a", { id: ID });
  });

  it("claimRoutes forwards user id and input", async () => {
    const repo = stubRepo();
    expect(await claimRoutes(repo, "user-a", { session_id: SESSION })).toEqual({ claimed_count: 0 });
    expect(repo.claimRoutes).toHaveBeenCalledExactlyOnceWith("user-a", { session_id: SESSION });
  });
});

describe("NeonSavedRouteRepo over the raw executor", () => {
  it("lists owned routes newest update first", async () => {
    const older = row({ id: "00000000-0000-4000-8000-000000000001", updated_at: "2026-07-12T00:00:00Z" });
    const newer = row({ id: "00000000-0000-4000-8000-000000000002", updated_at: "2026-07-13T00:00:00Z" });
    const repo = new NeonSavedRouteRepo(fakeDb([older, newer]).db);
    expect((await repo.listRoutes("user-a")).routes.map((route) => route.id)).toEqual([newer.id, older.id]);
  });

  it("creates a route and returns the normalized row", async () => {
    const repo = new NeonSavedRouteRepo(fakeDb().db);
    const route = await repo.saveRoute("user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" });
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
  });

  it("claims only still-anonymous rows of the session", async () => {
    const store = fakeDb([
      row({ session_id: SESSION, user_id: null }),
      row({ id: "00000000-0000-4000-8000-000000000002", session_id: SESSION, user_id: "user-b" }),
    ]);
    const repo = new NeonSavedRouteRepo(store.db);
    expect(await repo.claimRoutes("user-a", { session_id: SESSION })).toEqual({ claimed_count: 1 });
    expect(store.rows.map((item) => item.user_id)).toEqual(["user-a", "user-b"]);
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
    const [first] = (await repo.listRoutes("user-a")).routes as [
      UserRoute, ...UserRoute[],
    ];
    expect(first).toMatchObject({ id: "r1", title: "", point_ids: [] });
    expect(first.saved_at).toBe("2026-07-13T04:00:00.000Z");
  });

  it("rejects rows with an unparseable timestamp", async () => {
    const repo = new NeonSavedRouteRepo(rawDb({ id: "r2", title: "x", status: "saved", updated_at: 12345 }));
    await expect(repo.listRoutes("user-a")).rejects.toThrow("invalid timestamp row");
  });

  it("treats a missing/invalid owner as not-owned", async () => {
    const repo = new NeonSavedRouteRepo(rawDb({ id: "r3", user_id: 12345 }));
    await expect(repo.deleteRoute("user-a", { id: "r3" })).rejects.toMatchObject({
      code: "ROUTE_NOT_OWNED",
    });
  });
});
