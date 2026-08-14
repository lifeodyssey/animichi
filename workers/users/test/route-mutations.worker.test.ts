import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeDb, type FakeSavedRouteRow } from "./in-memory-routes-db";

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
    // The fake's delete dispatch matches on id AND user_id, so a successful
    // non-owner-visible delete of the caller's row proves the write is user-scoped.
    const { app, headers, rows } = setup([row()]);
    const response = await deleteSavedRoute(app, headers, SAVED_ROUTE_A);
    expect(response.status).toBe(200);
    expect(rows).toEqual([]);
  });
});
