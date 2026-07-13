import { UserRoute } from "@seichijunrei/contract";
import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { authTools, fakeDb, TEST_ENV } from "./helpers";

async function setup() {
  const auth = await authTools();
  const store = fakeDb();
  const app = createUsersApp({ getKey: auth.getKey, makeDb: () => store.db });
  const token = await auth.makeJwt({ sub: "user-a" });
  return { app, auth, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } };
}

function save(app: Awaited<ReturnType<typeof setup>>["app"], headers: Record<string, string>, body: unknown) {
  return app.request("/v1/users/routes", {
    method: "POST", headers, body: JSON.stringify(body),
  }, TEST_ENV);
}

describe("Users Worker routes wire", () => {
  it("saves then lists a route for the same JWT subject", async () => {
    const { app, headers } = await setup();
    const created = await save(app, headers, { title: "Tokyo", point_ids: ["p1"] });
    expect(created.status).toBe(200);
    const route: unknown = await created.json();
    expect(UserRoute.safeParse(route).success).toBe(true);
    const listed = await app.request("/v1/users/routes", { headers }, TEST_ENV);
    expect(await listed.json()).toMatchObject({ routes: [{ title: "Tokyo" }] });
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
    const { app, auth, headers } = await setup();
    const created = await save(app, headers, { title: "A", point_ids: [] });
    const route: unknown = await created.json();
    const parsed = UserRoute.parse(route);
    const userB = await auth.makeJwt({ sub: "user-b" });
    const response = await save(app, {
      Authorization: `Bearer ${userB}`, "content-type": "application/json",
    }, { id: parsed.id, title: "B", point_ids: [] });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      defined: true, code: "ROUTE_NOT_OWNED", status: 403,
      message: "Route belongs to another user", data: { route_id: parsed.id },
    });
  });

  it("returns 503 when the database is unconfigured", async () => {
    const { app, auth } = await setup();
    const token = await auth.makeJwt({ sub: "user-a" });
    const response = await app.request("/v1/users/routes", {
      headers: { Authorization: `Bearer ${token}` },
    }, { ENVIRONMENT: "test", NEON_AUTH_JWKS_URL: TEST_ENV.NEON_AUTH_JWKS_URL });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "users database not configured" });
  });
});
