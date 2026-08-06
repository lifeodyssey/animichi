import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { listRoutes, saveRoute } from "../src/api/routes";
import { listSessions } from "../src/api/routes";
import type { DbExecutor } from "../src/db/client";
import { fakeDb } from "./in-memory-routes-db";

const ID = "00000000-0000-4000-8000-000000000009";

/** A DbExecutor that answers ownership checks and serves fixed update rows. */
function updateRows(rows: Record<string, unknown>[]): DbExecutor {
  return {
    execute: (query) => {
      const rendered = new PgDialect().sqlToQuery(query);
      return rendered.sql.toLowerCase().includes("select user_id")
        ? Promise.resolve({ rows: [{ user_id: "user-a" }] })
        : Promise.resolve({ rows });
    },
  };
}

describe("route row validation", () => {
  it("throws on a route row whose id or status is malformed", async () => {
    await expect(saveRoute(updateRows([{ id: 42, title: "X", status: "bogus", point_ids: ["p1"] }]), "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid route row");
  });

  it("throws on a route row whose status is not a valid RouteStatus", async () => {
    await expect(saveRoute(updateRows([{ id: ID, title: "X", status: "bogus", point_ids: ["p1"] }]), "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid route row");
  });

  it("throws on a route row that is not an object", async () => {
    const nonObjectDb: DbExecutor = {
      execute: (query) => {
        const rendered = new PgDialect().sqlToQuery(query);
        return rendered.sql.toLowerCase().includes("select user_id")
          ? Promise.resolve({ rows: [{ user_id: "user-a" }] })
          : Promise.resolve({ rows: ["not-an-object"] });
      },
    };
    await expect(saveRoute(nonObjectDb, "user-a", {
      id: ID, title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("invalid route row");
  });

  it("lists a route with a null title as an empty string", async () => {
    const { db } = fakeDb([{
      id: ID, session_id: null, user_id: "user-a", title: null, point_ids: ["p1"],
      status: "saved", saved_at: "2026-07-13T00:00:00Z", updated_at: "2026-07-13T00:00:00Z",
    }]);
    const result = await listRoutes(db, "user-a");
    expect(result.routes[0]?.title).toBe("");
  });
});

describe("session row validation", () => {
  function sessionRows(rows: Record<string, unknown>[]): DbExecutor {
    return { execute: () => Promise.resolve({ rows }) };
  }

  it("throws on a session row whose session_id is malformed", async () => {
    const badDb = sessionRows([{
      session_id: 42, first_query: "q", title: "t",
      created_at: "2026-07-13T00:00:00Z", updated_at: "2026-07-13T00:00:00Z",
    }]);
    await expect(listSessions(badDb, "user-a", { limit: 1, offset: 0 })).rejects.toThrow("invalid session row");
  });

  it("throws on a session row that is not an object", async () => {
    const badDb: DbExecutor = { execute: () => Promise.resolve({ rows: ["not-an-object"] }) };
    await expect(listSessions(badDb, "user-a", { limit: 1, offset: 0 })).rejects.toThrow("invalid session row");
  });

  it("lists a session with a null title as null", async () => {
    const { db } = fakeDb([{
      id: ID, session_id: null, user_id: "user-a", title: null, point_ids: ["p1"],
      status: "saved", saved_at: "2026-07-13T00:00:00Z", updated_at: "2026-07-13T00:00:00Z",
    }]);
    const result = await listSessions(db, "user-a", { limit: 1, offset: 0 });
    expect(result.sessions[0]?.title).toBeNull();
  });
});
