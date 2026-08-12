import type { DeleteSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { deleteSavedRoute } from "../src/application/delete-saved-route";
import type {
  DeleteOwnedOutcome,
  DeleteSavedRouteObserver,
  DeleteSavedRouteObservability,
  DeleteSavedRouteStore,
} from "../src/application/delete-saved-route";
import type { DbExecutor } from "../src/db/client";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";

const ID = "00000000-0000-4000-8000-000000000009";
const UNKNOWN = "00000000-0000-4000-8000-000000000008";

function repo(db: DbExecutor): DeleteSavedRouteStore {
  return new NeonSavedRouteStore(db);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

/** An executor that records every rendered query while staying in-memory. */
function recording(seed: FakeSavedRouteRow[] = []): {
  db: DbExecutor; queries: { sql: string; params: unknown[] }[];
} {
  const { db } = fakeDb(seed);
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: { execute: (query) => {
      const rendered = new PgDialect().sqlToQuery(query);
      queries.push({ sql: rendered.sql.toLowerCase(), params: rendered.params });
      return db.execute(query);
    } },
    queries,
  };
}

function recordingObserver(): {
  observer: DeleteSavedRouteObserver; records: DeleteSavedRouteObservability[];
} {
  const records: DeleteSavedRouteObservability[] = [];
  return { observer: { record: (record) => { records.push(record); } }, records };
}

function storeReturning(outcome: DeleteOwnedOutcome): DeleteSavedRouteStore {
  return { deleteOwned: () => Promise.resolve(outcome) };
}

async function errorFor(input: DeleteSavedRouteInput, db: DbExecutor): Promise<ORPCError<string, unknown>> {
  try {
    await deleteSavedRoute(repo(db), "user-a", input);
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected deleteSavedRoute to reject");
}

describe("DeleteSavedRoute deletes an owned route", () => {
  it("returns deleted for an owned route", async () => {
    await expect(deleteSavedRoute(repo(fakeDb([row()]).db), "user-a", { id: ID }))
      .resolves.toEqual({ deleted: true });
  });

  it("runs exactly one atomic delete with no ownership read", async () => {
    const rec = recording([row()]);
    await deleteSavedRoute(repo(rec.db), "user-a", { id: ID });
    expect(rec.queries).toHaveLength(1);
    expect(rec.queries[0]?.sql).toContain("delete from saved_routes");
  });
});

describe("DeleteSavedRoute rejects unauthorized or absent routes", () => {
  it("returns SAVED_ROUTE_NOT_FOUND for an unknown id", async () => {
    const error = await errorFor({ id: UNKNOWN }, fakeDb().db);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for another user's route", async () => {
    const error = await errorFor({ id: ID }, fakeDb([row({ user_id: "user-b" })]).db);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED when the delete loses the race", async () => {
    const raceDb: DbExecutor = { execute: (query) => {
      const rendered = new PgDialect().sqlToQuery(query);
      return rendered.sql.toLowerCase().includes("select 1 from saved_routes")
        ? Promise.resolve({ rows: [{ exists: true }] })
        : Promise.resolve({ rows: [] });
    } };
    const error = await errorFor({ id: ID }, raceDb);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_FOUND when the row vanishes before the delete", async () => {
    const vanishedDb: DbExecutor = { execute: () => Promise.resolve({ rows: [] }) };
    const error = await errorFor({ id: ID }, vanishedDb);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });
});

describe("DeleteSavedRoute propagates a store failure", () => {
  it("re-throws a persistence failure", async () => {
    const failing: DeleteSavedRouteStore = {
      deleteOwned: () => Promise.reject(new Error("database unavailable")),
    };
    await expect(deleteSavedRoute(failing, "user-a", { id: ID })).rejects.toThrow("database unavailable");
  });
});

describe("DeleteSavedRoute records redacted observability", () => {
  it("records deleted for an owned route", async () => {
    const { observer, records } = recordingObserver();
    await deleteSavedRoute(repo(fakeDb([row()]).db), "user-a", { id: ID }, { observer });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("deleted");
    expect(typeof records[0]?.duration_ms).toBe("number");
  });

  it("records rejected for another user's route", async () => {
    const { observer, records } = recordingObserver();
    await expect(deleteSavedRoute(storeReturning({ kind: "not_owned" }), "user-a", { id: ID }, { observer }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED" });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("rejected");
  });

  it("records missing for an absent route", async () => {
    const { observer, records } = recordingObserver();
    await expect(deleteSavedRoute(storeReturning({ kind: "missing" }), "user-a", { id: ID }, { observer }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND" });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("missing");
  });

  it("records failure when the store rejects", async () => {
    const { observer, records } = recordingObserver();
    const failing: DeleteSavedRouteStore = { deleteOwned: () => Promise.reject(new Error("db")) };
    await expect(deleteSavedRoute(failing, "user-a", { id: ID }, { observer })).rejects.toThrow("db");
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("failure");
  });
});

describe("DeleteSavedRoute mutation guards", () => {
  it("scopes the atomic delete statement to the owning user", async () => {
    const rec = recording([row()]);
    await deleteSavedRoute(repo(rec.db), "user-a", { id: ID });
    const deleteQuery = rec.queries.find((query) => query.sql.includes("delete from saved_routes"));
    if (!deleteQuery) throw new Error("expected delete query");
    expect(deleteQuery.sql).toContain("user_id");
    expect(deleteQuery.params).toEqual([ID, "user-a"]);
  });

  it("deletes without exposing a cross-owner oracle", async () => {
    const rec = recording([row()]);
    await deleteSavedRoute(repo(rec.db), "user-a", { id: ID });
    expect(rec.queries.some((query) => query.sql.includes("select user_id"))).toBe(false);
  });
});
