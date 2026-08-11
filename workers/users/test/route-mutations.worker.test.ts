import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createUsersApp } from "../src/index";
import type { DbExecutor } from "../src/db/client";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";

const SAVED_ROUTE_A = "00000000-0000-4000-8000-00000000000a";
const SAVED_ROUTE_B = "00000000-0000-4000-8000-00000000000b";
const UNKNOWN = "00000000-0000-4000-8000-00000000000f";
const SESSION = "anonymous-session";

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: SAVED_ROUTE_A, claim_session_id: null, user_id: "user-a", title: "Tokyo",
    point_ids: [], status: "saved", saved_at: null,
    updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

async function setup(seed: FakeSavedRouteRow[] = []) {
  const store = fakeDb(seed);
  const app = createUsersApp({ makeDb: () => store.db });
  const headers = identityHeaders("user-a", { "content-type": "application/json" });
  return { app, headers, rows: store.rows };
}

function deleteSavedRoute(app: Awaited<ReturnType<typeof setup>>["app"], headers: HeadersInit, id: string) {
  return app.request(`/v1/users/saved-routes/${id}`, { method: "DELETE", headers }, TEST_ENV);
}

function claimSavedRoutes(app: Awaited<ReturnType<typeof setup>>["app"], headers: HeadersInit) {
  return app.request("/v1/users/saved-routes/claim", {
    method: "POST", headers,     body: JSON.stringify({ session_id: SESSION }),
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
    return Promise.resolve({ rows: [{ id: SAVED_ROUTE_A }] });
  };
  return { db: { execute }, query: () => requiredMutation(mutation) };
}

async function setupWith(db: DbExecutor) {
  const app = createUsersApp({ makeDb: () => db });
  return { app, headers: identityHeaders("user-a", { "content-type": "application/json" }) };
}

describe("saved-route deletion wire", () => {
  it("deletes a saved route owned by the JWT subject", async () => {
    const { app, headers, rows } = await setup([row()]);
    const response = await deleteSavedRoute(app, headers, SAVED_ROUTE_A);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(rows).toEqual([]);
  });

  it("returns SAVED_ROUTE_NOT_FOUND for an unknown route", async () => {
    const { app, headers } = await setup();
    const response = await deleteSavedRoute(app, headers, UNKNOWN);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      defined: true, code: "SAVED_ROUTE_NOT_FOUND", data: { saved_route_id: UNKNOWN },
    });
  });

  it("cannot delete another user's route", async () => {
    const seed = row({ user_id: "user-b" });
    const { app, headers, rows } = await setup([seed]);
    const response = await deleteSavedRoute(app, headers, SAVED_ROUTE_A);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ defined: true, code: "SAVED_ROUTE_NOT_OWNED" });
    expect(rows).toEqual([seed]);
  });

  it("scopes the atomic delete statement to saved-route id and user id", async () => {
    const capture = captureDb([{ user_id: "user-a" }]);
    const { app, headers } = await setupWith(capture.db);
    expect((await deleteSavedRoute(app, headers, SAVED_ROUTE_A)).status).toBe(200);
    const rendered = new PgDialect().sqlToQuery(capture.query());
    expect(rendered.sql.toLowerCase()).toContain("user_id");
    expect(rendered.params).toEqual([SAVED_ROUTE_A, "user-a"]);
  });
});

describe("anonymous saved-route claim wire", () => {
  it("claims every anonymous saved route in the session and returns the count", async () => {
    const { app, headers, rows } = await setup([
      row({ claim_session_id: SESSION, user_id: null }),
      row({ id: SAVED_ROUTE_B, claim_session_id: SESSION, user_id: null }),
    ]);
    const response = await claimSavedRoutes(app, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed_count: 2 });
    expect(rows.map((item) => item.user_id)).toEqual(["user-a", "user-a"]);
  });

  it("is idempotent when the same session is claimed twice", async () => {
    const { app, headers } = await setup([row({ claim_session_id: SESSION, user_id: null })]);
    expect(await (await claimSavedRoutes(app, headers)).json()).toEqual({ claimed_count: 1 });
    expect(await (await claimSavedRoutes(app, headers)).json()).toEqual({ claimed_count: 0 });
  });

  it("returns zero when the session has no saved routes", async () => {
    const { app, headers } = await setup();
    const response = await claimSavedRoutes(app, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed_count: 0 });
  });

  it("cannot steal a route already owned by another user", async () => {
    const seed = row({ claim_session_id: SESSION, user_id: "user-b" });
    const { app, headers, rows } = await setup([seed]);
    const response = await claimSavedRoutes(app, headers);
    expect(await response.json()).toEqual({ claimed_count: 0 });
    expect(rows).toEqual([seed]);
  });

  it("claims only null owners in one session-scoped update", async () => {
    const capture = captureDb();
    const { app, headers } = await setupWith(capture.db);
    expect((await claimSavedRoutes(app, headers)).status).toBe(200);
    const rendered = new PgDialect().sqlToQuery(capture.query());
    expect(rendered.sql.toLowerCase()).toContain("user_id is null");
    expect(rendered.params).toEqual(["user-a", SESSION]);
  });
});
