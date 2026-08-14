import type { SaveSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import type { UsersDb } from "../src/db/client";
import { fakeDb, fakeDbFrom, recordingDb, type FakeSavedRouteRow, type RecordedQuery } from "./in-memory-routes-db";

const ID = "00000000-0000-4000-8000-000000000009";
const UNKNOWN = "00000000-0000-4000-8000-000000000008";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };

function repo(db: UsersDb): SavedRouteStore {
  return new NeonSavedRouteStore(db);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: null, updated_at: NOW, ...overrides,
  };
}

/** A UsersDb that records every rendered query while staying in-memory. */
function recording(seed: FakeSavedRouteRow[] = []): { db: UsersDb; queries: string[] } {
  const recorded = recordingDb(seed);
  return { db: recorded.db, queries: recorded.sqls };
}

async function errorFor(input: SaveSavedRouteInput, db: UsersDb): Promise<ORPCError<string, unknown>> {
  try {
    await saveSavedRoute(repo(db), "user-a", input, FIXED_NOW);
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected saveSavedRoute to reject");
}

describe("SaveSavedRoute creates a route", () => {
  it("makes exactly one authenticated insert", async () => {
    const rec = recording();
    const route = await saveSavedRoute(
      repo(rec.db), "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW,
    );
    expect(rec.queries).toHaveLength(1);
    expect(rec.queries[0]).toContain("insert into \"saved_routes\"");
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
  });

  it("stamps saved_at now for a saved route", async () => {
    const route = await saveSavedRoute(
      repo(fakeDb().db), "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW,
    );
    expect(route.saved_at).toBe(NOW);
  });

  it("leaves saved_at null for a draft", async () => {
    const route = await saveSavedRoute(
      repo(fakeDb().db), "user-a", { title: "Draft", point_ids: [], status: "draft" }, FIXED_NOW,
    );
    expect(route.saved_at).toBeNull();
  });
});

describe("SaveSavedRoute updates an owned route", () => {
  it("does one ownership read then one authenticated update", async () => {
    const rec = recording([row()]);
    await saveSavedRoute(repo(rec.db), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    expect(rec.queries).toHaveLength(2);
    expect(rec.queries[0]).toContain("select \"user_id\"");
    expect(rec.queries[1]).toContain("update \"saved_routes\"");
  });

  it("returns the updated row", async () => {
    const { db } = fakeDb([row()]);
    const route = await saveSavedRoute(repo(db), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    expect(route).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("preserves the previous saved_at for a non-draft status", async () => {
    const previous = "2026-07-12T00:00:00.000Z";
    const { db } = fakeDb([row({ saved_at: previous })]);
    const route = await saveSavedRoute(repo(db), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(route.saved_at).toBe(previous);
  });

  it("stamps saved_at now when a null non-draft is updated", async () => {
    const { db } = fakeDb([row({ status: "saved", saved_at: null })]);
    const route = await saveSavedRoute(repo(db), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "completed",
    }, FIXED_NOW);
    expect(route.saved_at).toBe(NOW);
  });

  it("clears saved_at when the route moves to draft", async () => {
    const { db } = fakeDb([row({ status: "saved", saved_at: "2026-07-12T00:00:00.000Z" })]);
    const route = await saveSavedRoute(repo(db), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "draft",
    }, FIXED_NOW);
    expect(route.saved_at).toBeNull();
  });

  it("scopes the update to the owning user", async () => {
    const scoped = updateCapture();
    await saveSavedRoute(repo(scoped.db), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    const rendered = requiredUpdate(scoped.update);
    expect(rendered.sql).toContain("\"user_id\"");
    expect(rendered.params).toContain("user-a");
  });
});

/** A UsersDb that answers the ownership read and captures the update params. */
function updateCapture(): { db: UsersDb; update: () => RecordedQuery | undefined } {
  let update: RecordedQuery | undefined;
  const db = fakeDbFrom((sql, params) => {
    if (sql.includes("select \"user_id\"")) return [{ user_id: "user-a" }];
    update = { sql, params };
    return [row()];
  });
  return { db, update: () => update };
}

function requiredUpdate(capture: () => RecordedQuery | undefined): RecordedQuery {
  const update = capture();
  if (!update) throw new Error("expected update query");
  return update;
}

describe("SaveSavedRoute rejects unauthorized or failed writes", () => {
  it("returns SAVED_ROUTE_NOT_FOUND for an unknown id", async () => {
    const error = await errorFor({ id: UNKNOWN, title: "X", point_ids: [], status: "saved" }, fakeDb().db);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for another user's route", async () => {
    const db = fakeDb([row({ user_id: "user-b" })]).db;
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, db);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for an unclaimed route with no owner", async () => {
    const db = fakeDb([row({ user_id: null })]).db;
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, db);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED when the update loses the race", async () => {
    const raceDb: UsersDb = fakeDbFrom((sql) =>
      sql.includes("select \"user_id\"") ? [{ user_id: "user-a" }] : [],
    );
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, raceDb);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("propagates a persistence failure", async () => {
    // A failed request must surface to the caller — never rewritten into a
    // domain error or swallowed. The rejection is raised at the execution seam
    // (instance `execute`), so it propagates exactly as a real driver failure.
    const failing = fakeDb().db;
    (failing as unknown as { execute: () => Promise<{ rows: unknown[] }> }).execute = () =>
      Promise.reject(new Error("database unavailable"));
    await expect(saveSavedRoute(repo(failing), "user-a", {
      title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow();
  });
});
