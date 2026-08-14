import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { listSavedRoutes as listSavedRoutesAction } from "../src/application/list-saved-routes";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import type { UsersDb } from "../src/db/client";
import { fakeDb, fakeDbFrom } from "./in-memory-routes-db";

const isOwnershipRead = (sql: string): boolean =>
  sql.toLowerCase().includes('"user_id"') && sql.toLowerCase().includes("saved_routes");

const ID = "00000000-0000-4000-8000-000000000009";

/** A UsersDb that answers ownership checks and serves fixed update rows. */
function updateRows(rows: Record<string, unknown>[]): UsersDb {
  return fakeDbFrom((sql) =>
    isOwnershipRead(sql) ? [{ user_id: "user-a" }] : rows,
  );
}

/** Real Neon adapter over the fixed-answer database. */
function repo(db: UsersDb): SavedRouteStore {
  return new NeonSavedRouteStore(db);
}

describe("saved-route row validation", () => {
  it("throws on a route row whose id or status is malformed", async () => {
    await expect(saveSavedRoute(repo(updateRows([{ id: 42, title: "X", status: "bogus", point_ids: ["p1"] }])), "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid saved route row");
  });

  it("throws on a route row whose status is not a valid SavedRouteStatus", async () => {
    await expect(saveSavedRoute(repo(updateRows([{ id: ID, title: "X", status: "bogus", point_ids: ["p1"] }])), "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid saved route row");
  });

  it("throws on a route row that is not an object", async () => {
    const nonObjectDb: UsersDb = fakeDbFrom((sql) =>
      isOwnershipRead(sql) ? [{ user_id: "user-a" }] : ["not-an-object"],
    );
    await expect(saveSavedRoute(repo(nonObjectDb), "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid saved route row");
  });

  it("lists a route with a null title as an empty string", async () => {
    const { db } = fakeDb([{
      id: ID, user_id: "user-a", title: null, point_ids: ["p1"],
      status: "saved", saved_at: "2026-07-13T00:00:00Z", updated_at: "2026-07-13T00:00:00Z",
    }]);
    const result = await listSavedRoutesAction(new NeonSavedRouteRepo(db), "user-a");
    expect(result.saved_routes[0]?.title).toBe("");
  });
});
