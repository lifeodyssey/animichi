import { SavedRoute } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeDb } from "./in-memory-routes-db";

async function setup() {
  const store = fakeDb();
  const app = createUsersApp({ makeDb: () => store.db });
  const headers = identityHeaders("user-a", { "content-type": "application/json" });
  return { app, headers };
}

function save(app: Awaited<ReturnType<typeof setup>>["app"], headers: Record<string, string>, body: unknown) {
  return app.request("/v1/users/saved-routes", {
    method: "POST", headers, body: JSON.stringify(body),
  }, TEST_ENV);
}

describe("Users Worker saved-routes wire", () => {
  it("saves then lists a saved route for the same edge-forwarded identity", async () => {
    const { app, headers } = await setup();
    const created = await save(app, headers, { title: "Tokyo", point_ids: ["p1"] });
    expect(created.status).toBe(200);
    const savedRoute: unknown = await created.json();
    expect(SavedRoute.safeParse(savedRoute).success).toBe(true);
    const listed = await app.request("/v1/users/saved-routes", { headers }, TEST_ENV);
    expect(await listed.json()).toMatchObject({ saved_routes: [{ title: "Tokyo" }] });
  });

  it("lists sessions through the identity-guarded users endpoint", async () => {
    const { app, headers } = await setup();
    const response = await app.request("/v1/users/sessions?limit=1", { headers }, TEST_ENV);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions: [], next_offset: null });
  });

  it.each([
    [{ point_ids: [] }, "missing title"],
    [{ title: "", point_ids: [] }, "empty title"],
    [{ title: "X", point_ids: Array.from({ length: 501 }, (_, i) => String(i)) }, "501 points"],
    [{ title: "X", point_ids: [], status: "invalid" }, "bad status"],
  ])("returns 400 for %s (%s)", async (body, _label) => {
    const { app, headers } = await setup();
    expect((await save(app, headers, body)).status).toBe(400);
  });

  it("serializes the defined ownership error for a cross-user update", async () => {
    const { app, headers } = await setup();
    const created = await save(app, headers, { title: "A", point_ids: [] });
    const savedRoute: unknown = await created.json();
    const parsed = SavedRoute.parse(savedRoute);
    const userB = identityHeaders("user-b", { "content-type": "application/json" });
    const response = await save(app, userB, { id: parsed.id, title: "B", point_ids: [] });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      defined: true, code: "SAVED_ROUTE_NOT_OWNED", status: 403,
      message: "Route belongs to another user", data: { saved_route_id: parsed.id },
    });
  });

  it("returns 503 when the database is unconfigured", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/users/saved-routes", {
      headers: identityHeaders("user-a"),
    }, { ENVIRONMENT: "test" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "users database not configured" });
  });
});
