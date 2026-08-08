import type { SaveSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo } from "../src/adapters/neon-saved-route-repo";
import { listSavedRoutes, saveSavedRoute, deleteSavedRoute } from "../src/api/routes";
import { listSessions } from "../src/api/routes";
import type { DbExecutor } from "../src/db/client";
import type { SavedRouteRepo } from "../src/domain/ports";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";

const ID = "00000000-0000-4000-8000-000000000009";
const RAW = "2026-07-13 12:34:56+00";
const UPDATE_INPUT: SaveSavedRouteInput = {
  id: ID, title: "X", point_ids: [], status: "saved",
};

/** Real Neon adapter over the fake executor — saved-route SQL still verified. */
function repo(db: DbExecutor): SavedRouteRepo {
  return new NeonSavedRouteRepo(db);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, claim_session_id: null, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: RAW, updated_at: RAW, first_query: "Find Tokyo", ...overrides,
  };
}

async function caught(
  input: SaveSavedRouteInput, db: DbExecutor = fakeDb([row({ user_id: "user-b" })]).db,
): Promise<ORPCError<string, unknown>> {
  try {
    await saveSavedRoute(repo(db), "user-a", input);
  } catch (error) {
    return orpcError(error);
  }
  throw new Error("expected saveSavedRoute to reject");
}

function orpcError(error: unknown): ORPCError<string, unknown> {
  expect(error).toBeInstanceOf(ORPCError);
  return error as ORPCError<string, unknown>;
}

describe("user saved-route handlers", () => {
  it("lists an empty store", async () => {
    expect(await listSavedRoutes(repo(fakeDb().db), "user-a")).toEqual({ saved_routes: [] });
  });

  it("creates a saved route with normalized timestamps", async () => {
    const result = await saveSavedRoute(repo(fakeDb().db), "user-a", {
      title: "Tokyo", point_ids: ["p1"], status: "saved",
    });
    expect(result).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(result.saved_at).toBe("2026-07-13T04:00:00.000Z");
    expect(result.updated_at).toBe("2026-07-13T04:00:00.000Z");
  });

  it("creates a draft with no saved timestamp", async () => {
    const result = await saveSavedRoute(repo(fakeDb().db), "user-a", {
      title: "Draft", point_ids: [], status: "draft",
    });
    expect(result.saved_at).toBeNull();
  });

  it("throws SAVED_ROUTE_NOT_FOUND for an unknown update id", async () => {
    const error = await caught({ id: "00000000-0000-4000-8000-000000000008", title: "X", point_ids: [], status: "saved" });
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("throws SAVED_ROUTE_NOT_OWNED for another user's saved route", async () => {
    const error = await caught({ id: ID, title: "X", point_ids: [], status: "saved" });
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("updates an owned saved route and returns the updated row", async () => {
    const { db } = fakeDb([row()]);
    const result = await saveSavedRoute(repo(db), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    });
    expect(result).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("normalizes raw workerd timestamp strings while listing", async () => {
    const result = await listSavedRoutes(repo(fakeDb([row()]).db), "user-a");
    expect(result.saved_routes[0]?.saved_at).toBe("2026-07-13T12:34:56.000Z");
    expect(result.saved_routes[0]?.updated_at).toBe("2026-07-13T12:34:56.000Z");
  });
});

describe("deleteSavedRoute ownership", () => {
  it("throws SAVED_ROUTE_NOT_OWNED when deleting an unknown saved route", async () => {
    const { db } = fakeDb([row({ user_id: "user-b" })]);
    await expect(deleteSavedRoute(repo(db), "user-a", { id: ID })).rejects.toMatchObject({
      code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true,
    });
  });

  it("throws SAVED_ROUTE_NOT_OWNED when the delete loses the race", async () => {
    const raceDb: DbExecutor = {
      execute: (query) => {
        const rendered = new PgDialect().sqlToQuery(query);
        return rendered.sql.toLowerCase().includes("select user_id")
          ? Promise.resolve({ rows: [{ user_id: "user-a" }] })
          : Promise.resolve({ rows: [] });
      },
    };
    await expect(deleteSavedRoute(repo(raceDb), "user-a", { id: ID })).rejects.toMatchObject({
      code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true,
    });
  });

  it("deletes an owned saved route", async () => {
    const { db } = fakeDb([row()]);
    await expect(deleteSavedRoute(repo(db), "user-a", { id: ID })).resolves.toEqual({ deleted: true });
  });
});

describe("user session handlers", () => {
  it("lists only owned sessions in stable newest-first pages", async () => {
    const older = row({ id: "00000000-0000-4000-8000-000000000001", first_query: "older", updated_at: "2026-07-12T00:00:00Z" });
    const newer = row({ id: "00000000-0000-4000-8000-000000000002", first_query: "newer", updated_at: "2026-07-13T00:00:00Z" });
    const other = row({ id: "00000000-0000-4000-8000-000000000003", user_id: "user-b" });
    const result = await listSessions(fakeDb([older, newer, other]).db, "user-a", { limit: 1, offset: 0 });
    expect(result.sessions.map((session) => session.first_query)).toEqual(["newer"]);
    expect(result.next_offset).toBe(1);
  });

  it("caps next_offset at the contract offset ceiling", async () => {
    const rows = Array.from({ length: 1050 }, (_, i) => row({ claim_session_id: `s-${String(i)}` }));
    const result = await listSessions(fakeDb(rows).db, "user-a", { limit: 30, offset: 980 });
    expect(result.next_offset).toBeNull();
  });

  it("returns the final page without a next offset", async () => {
    const result = await listSessions(fakeDb([row()]).db, "user-a", { limit: 2, offset: 0 });
    expect(result.next_offset).toBeNull();
    expect(result.sessions[0]).toMatchObject({ session_id: ID, title: "Tokyo" });
  });
});

describe("atomic saved-route updates", () => {
  it("throws SAVED_ROUTE_NOT_OWNED when an owned update loses the race", async () => {
    const inlineDb: DbExecutor = { execute: (query) => {
      const rendered = new PgDialect().sqlToQuery(query);
      if (rendered.sql.toLowerCase().includes("select user_id")) {
        return Promise.resolve({ rows: [{ user_id: "user-a" }] });
      }
      return Promise.resolve({ rows: [] });
    } };
    const error = await caught(UPDATE_INPUT, inlineDb);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("includes user_id in the atomic update predicate", async () => {
    let updateQuery: SQL | undefined;
    const inlineDb: DbExecutor = { execute: (query) => {
      const rendered = new PgDialect().sqlToQuery(query);
      if (rendered.sql.toLowerCase().includes("select user_id")) {
        return Promise.resolve({ rows: [{ user_id: "user-a" }] });
      }
      updateQuery = query;
      return Promise.resolve({ rows: [] });
    } };
    await caught(UPDATE_INPUT, inlineDb);
    if (!updateQuery) throw new Error("expected update query");
    const rendered = new PgDialect().sqlToQuery(updateQuery);
    expect(rendered.sql).toContain("user_id");
    expect(rendered.params).toContain("user-a");
  });
});
