import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createUsersApp } from "../src/index";
import type { DbExecutor } from "../src/db/client";
import { authTools, fakeDb, type FakeRouteRow, TEST_ENV } from "./helpers";

const ROUTE_A = "00000000-0000-4000-8000-00000000000a";
const ROUTE_B = "00000000-0000-4000-8000-00000000000b";
const UNKNOWN = "00000000-0000-4000-8000-00000000000f";
const SESSION = "anonymous-session";

function row(overrides: Partial<FakeRouteRow> = {}): FakeRouteRow {
  return {
    id: ROUTE_A, session_id: null, user_id: "user-a", title: "Tokyo",
    point_ids: [], status: "saved", saved_at: null,
    updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

async function setup(seed: FakeRouteRow[] = []) {
  const auth = await authTools();
  const store = fakeDb(seed);
  const app = createUsersApp({ getKey: auth.getKey, makeDb: () => store.db });
  const token = await auth.makeJwt({ sub: "user-a" });
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  return { app, headers, rows: store.rows };
}

function deleteRoute(app: Awaited<ReturnType<typeof setup>>["app"], headers: HeadersInit, id: string) {
  return app.request(`/v1/users/routes/${id}`, { method: "DELETE", headers }, TEST_ENV);
}

function claimRoutes(app: Awaited<ReturnType<typeof setup>>["app"], headers: HeadersInit) {
  return app.request("/v1/users/routes/claim", {
    method: "POST", headers, body: JSON.stringify({ session_id: SESSION }),
  }, TEST_ENV);
}

function requiredMutation(mutation: SQL | undefined): SQL {
  if (!mutation) throw new Error("expected mutation query");
  return mutation;
}

function captureDb(ownerRows: unknown[] = []) {
  let mutation: SQL | undefined;
  const execute: DbExecutor["execute"] = (query) => {
    const rendered = new PgDialect().sqlToQuery(query).sql.toLowerCase();
    if (rendered.includes("select user_id")) return Promise.resolve({ rows: ownerRows });
    mutation = query;
    return Promise.resolve({ rows: [{ id: ROUTE_A }] });
  };
  return { db: { execute }, query: () => requiredMutation(mutation) };
}

async function setupWith(db: DbExecutor) {
  const auth = await authTools();
  const token = await auth.makeJwt({ sub: "user-a" });
  const app = createUsersApp({ getKey: auth.getKey, makeDb: () => db });
  return { app, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } };
}

describe("route deletion wire", () => {
  it("deletes a route owned by the JWT subject", async () => {
    const { app, headers, rows } = await setup([row()]);
    const response = await deleteRoute(app, headers, ROUTE_A);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(rows).toEqual([]);
  });

  it("returns ROUTE_NOT_FOUND for an unknown route", async () => {
    const { app, headers } = await setup();
    const response = await deleteRoute(app, headers, UNKNOWN);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      defined: true, code: "ROUTE_NOT_FOUND", data: { route_id: UNKNOWN },
    });
  });

  it("cannot delete another user's route", async () => {
    const seed = row({ user_id: "user-b" });
    const { app, headers, rows } = await setup([seed]);
    const response = await deleteRoute(app, headers, ROUTE_A);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ defined: true, code: "ROUTE_NOT_OWNED" });
    expect(rows).toEqual([seed]);
  });

  it("scopes the atomic delete statement to route id and user id", async () => {
    const capture = captureDb([{ user_id: "user-a" }]);
    const { app, headers } = await setupWith(capture.db);
    expect((await deleteRoute(app, headers, ROUTE_A)).status).toBe(200);
    const rendered = new PgDialect().sqlToQuery(capture.query());
    expect(rendered.sql.toLowerCase()).toContain("user_id");
    expect(rendered.params).toEqual([ROUTE_A, "user-a"]);
  });
});

describe("anonymous route claim wire", () => {
  it("claims every anonymous route in the session and returns the count", async () => {
    const { app, headers, rows } = await setup([
      row({ session_id: SESSION, user_id: null }),
      row({ id: ROUTE_B, session_id: SESSION, user_id: null }),
    ]);
    const response = await claimRoutes(app, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed_count: 2 });
    expect(rows.map((item) => item.user_id)).toEqual(["user-a", "user-a"]);
  });

  it("is idempotent when the same session is claimed twice", async () => {
    const { app, headers } = await setup([row({ session_id: SESSION, user_id: null })]);
    expect(await (await claimRoutes(app, headers)).json()).toEqual({ claimed_count: 1 });
    expect(await (await claimRoutes(app, headers)).json()).toEqual({ claimed_count: 0 });
  });

  it("returns zero when the session has no routes", async () => {
    const { app, headers } = await setup();
    const response = await claimRoutes(app, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed_count: 0 });
  });

  it("cannot steal a route already owned by another user", async () => {
    const seed = row({ session_id: SESSION, user_id: "user-b" });
    const { app, headers, rows } = await setup([seed]);
    const response = await claimRoutes(app, headers);
    expect(await response.json()).toEqual({ claimed_count: 0 });
    expect(rows).toEqual([seed]);
  });

  it("claims only null owners in one session-scoped update", async () => {
    const capture = captureDb();
    const { app, headers } = await setupWith(capture.db);
    expect((await claimRoutes(app, headers)).status).toBe(200);
    const rendered = new PgDialect().sqlToQuery(capture.query());
    expect(rendered.sql.toLowerCase()).toContain("user_id is null");
    expect(rendered.params).toEqual(["user-a", SESSION]);
  });
});
