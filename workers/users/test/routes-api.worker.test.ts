import type { SaveSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { listSavedRoutes as listSavedRoutesAction } from "../src/application/list-saved-routes";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { DbExecutor } from "../src/db/client";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";

const ID = "00000000-0000-4000-8000-000000000009";
const RAW = "2026-07-13 12:34:56+00";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };
const UPDATE_INPUT: SaveSavedRouteInput = {
  id: ID, title: "X", point_ids: [], status: "saved",
};

/** Real Neon adapter over the fake executor — saved-route SQL still verified. */
function repo(db: DbExecutor): NeonSavedRouteRepo {
  return new NeonSavedRouteRepo(db);
}

/** The write-role adapter split (USERS-2 review: ≤50-line classes). */
function store(db: DbExecutor): NeonSavedRouteStore {
  return new NeonSavedRouteStore(db);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: RAW, updated_at: RAW, first_query: "Find Tokyo", ...overrides,
  };
}

async function caught(
  input: SaveSavedRouteInput, db: DbExecutor = fakeDb([row({ user_id: "user-b" })]).db,
): Promise<ORPCError<string, unknown>> {
  try {
    await saveSavedRoute(store(db), "user-a", input, FIXED_NOW);
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
  it("lists an empty store through the ListSavedRoutes action", async () => {
    expect(await listSavedRoutesAction(repo(fakeDb().db), "user-a")).toEqual({ saved_routes: [] });
  });

  it("creates a saved route with normalized timestamps", async () => {
    const result = await saveSavedRoute(store(fakeDb().db), "user-a", {
      title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(result).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(result.saved_at).toBe(NOW);
    expect(result.updated_at).toBe(NOW);
  });

  it("creates a draft with no saved timestamp", async () => {
    const result = await saveSavedRoute(store(fakeDb().db), "user-a", {
      title: "Draft", point_ids: [], status: "draft",
    }, FIXED_NOW);
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
    const result = await saveSavedRoute(store(db), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    expect(result).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("normalizes raw workerd timestamp strings while listing", async () => {
    const result = await listSavedRoutesAction(repo(fakeDb([row()]).db), "user-a");
    expect(result.saved_routes[0]?.saved_at).toBe("2026-07-13T12:34:56.000Z");
    expect(result.saved_routes[0]?.updated_at).toBe("2026-07-13T12:34:56.000Z");
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
