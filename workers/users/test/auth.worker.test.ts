import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeDb } from "./in-memory-routes-db";

const unauthorized = {
  error: { code: "unauthorized", message: "Valid credentials required." },
};

async function request(headers: Record<string, string> = {}, env = TEST_ENV): Promise<Response> {
  const { db } = fakeDb();
  const app = createUsersApp({ makeDb: () => db });
  return app.request("/v1/users/saved-routes", { headers }, env);
}

describe("Users Worker internal-identity boundary (AUTH-2 #950)", () => {
  it("rejects a request with no X-User-Id header", () => expectUnauthorized({}));
  it("rejects an empty X-User-Id header", () => expectUnauthorized(identityHeaders(" ")));
  it("rejects identity without X-User-Type", () => expectUnauthorized({ "X-User-Id": "user-a" }));
  it("rejects anonymous identity", () => expectUnauthorized(identityHeaders("user-a", { "X-User-Type": "anonymous" })));
  it("rejects an unknown identity type", () => expectUnauthorized(identityHeaders("user-a", { "X-User-Type": "service" })));

  it("rejects a raw bearer access attempt — users no longer verifies JWTs itself", async () => {
    const response = await request({
      Authorization: "Bearer eyJhbGciOiJFZERTQSJ9.payload.sig",
      ...identityHeaders("user-a"),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(unauthorized);
  });

  it("accepts the edge's verified identity", async () => {
    const response = await request(identityHeaders("user-a"));
    expect(response.status).toBe(200);
  });

  it("serves health without identity", async () => {
    const response = await createUsersApp().request("/healthz", {}, { ENVIRONMENT: "test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", service: "users" });
  });

  it("returns 503 when the database is unconfigured", async () => {
    const response = await request(identityHeaders("user-a"), { ENVIRONMENT: "test" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "users database not configured" });
  });
});

async function expectUnauthorized(headers: Record<string, string>): Promise<void> {
  const response = await request(headers);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(unauthorized);
}
