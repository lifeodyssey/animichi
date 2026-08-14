import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import type { UsersDb } from "../src/db/client";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeDb, fakeDbFrom, type FakeSavedRouteRow, type RecordedQuery } from "./in-memory-routes-db";

const SAVED_ROUTE_A = "00000000-0000-4000-8000-00000000000a";
const UNKNOWN = "00000000-0000-4000-8000-00000000000f";

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: SAVED_ROUTE_A, user_id: "user-a", title: "Tokyo",
    point_ids: [], status: "saved", saved_at: null,
    updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

function setup(seed: FakeSavedRouteRow[] = []) {
  const store = fakeDb(seed);
  const app = createUsersApp({ makeDb: () => store.db });
  const headers = identityHeaders("user-a", { "content-type": "application/json" });
  return { app, headers, rows: store.rows };
}

function deleteSavedRoute(app: Awaited<ReturnType<typeof setup>>["app"], headers: HeadersInit, id: string) {
  return app.request(`/v1/users/saved-routes/${id}`, { method: "DELETE", headers }, TEST_ENV);
}

function requiredMutation(mutation: RecordedQuery | undefined): RecordedQuery {
  if (!mutation) throw new Error("expected mutation query");
  return mutation;
}

function captureDb(ownerRows: unknown[] = []) {
  let mutation: RecordedQuery | undefined;
  const db: UsersDb = fakeDbFrom((sql, params) => {
    if (sql.includes("select \"user_id\"")) return ownerRows;
    mutation = { sql, params };
    return [{ id: SAVED_ROUTE_A }];
  });
  return { db, query: () => requiredMutation(mutation) };
}

function setupWith(db: UsersDb) {
  const app = createUsersApp({ makeDb: () => db });
  return { app, headers: identityHeaders("user-a", { "content-type": "application/json" }) };
}

describe("saved-route deletion wire", () => {
  it("deletes a saved route owned by the JWT subject", async () => {
    const { app, headers, rows } = setup([row()]);
    const response = await deleteSavedRoute(app, headers, SAVED_ROUTE_A);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(rows).toEqual([]);
  });

  it("returns SAVED_ROUTE_NOT_FOUND for an unknown route", async () => {
    const { app, headers } = setup();
    const response = await deleteSavedRoute(app, headers, UNKNOWN);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      defined: true, code: "SAVED_ROUTE_NOT_FOUND", data: { saved_route_id: UNKNOWN },
    });
  });

  it("cannot delete another user's route", async () => {
    const seed = row({ user_id: "user-b" });
    const { app, headers, rows } = setup([seed]);
    const response = await deleteSavedRoute(app, headers, SAVED_ROUTE_A);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ defined: true, code: "SAVED_ROUTE_NOT_OWNED" });
    expect(rows).toEqual([seed]);
  });

  it("scopes the atomic delete statement to saved-route id and user id", async () => {
    const capture = captureDb([{ user_id: "user-a" }]);
    const { app, headers } = setupWith(capture.db);
    expect((await deleteSavedRoute(app, headers, SAVED_ROUTE_A)).status).toBe(200);
    const rendered = capture.query();
    expect(rendered.sql.toLowerCase()).toContain("\"user_id\"");
    expect(rendered.params).toEqual([SAVED_ROUTE_A, "user-a"]);
  });
});
