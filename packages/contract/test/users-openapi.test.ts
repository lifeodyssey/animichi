import { describe, expect, it } from "vitest";
import usersOpenApi from "../users-openapi.json";

const BEARER_SECURITY = [{ bearerAuth: [] }];

describe("users OpenAPI security", () => {
  it("no longer exposes a session-list endpoint (SESSION-1 #959)", () => {
    expect(usersOpenApi.paths["/v1/users/sessions"]).toBeUndefined();
  });

  it("defines HTTP bearer JWT authentication", () => {
    expect(usersOpenApi.components.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    });
  });

  it("exposes exactly the mounted saved-route operations (no phantom surfaces)", () => {
    // Phantom check-in/share operations are hard-cut pre-go-live (#1005): the
    // users OpenAPI must advertise only what the mounted Users router serves.
    expect(Object.keys(usersOpenApi.paths).sort()).toEqual([
      "/v1/users/saved-routes",
      "/v1/users/saved-routes/{id}",
    ]);
    expect(usersOpenApi.paths["/v1/users/checkins"]).toBeUndefined();
    expect(usersOpenApi.paths["/v1/users/shares"]).toBeUndefined();
    expect(usersOpenApi.paths["/v1/users/shares/{share_id}"]).toBeUndefined();
    expect(usersOpenApi.paths["/v1/users/shares/resolve/{token}"]).toBeUndefined();
  });

  it("requires bearer authentication for every saved-route operation", () => {
    expect(usersOpenApi.paths["/v1/users/saved-routes"].get.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/saved-routes"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/saved-routes/{id}"].delete.security).toEqual(BEARER_SECURITY);
  });
});

describe("retry-safe SavedRoute creation is documented and owner-scoped (issue #1011 AC1)", () => {
  it("documents an optional Idempotency-Key header on the save operation", () => {
    const parameters = usersOpenApi.paths["/v1/users/saved-routes"].post.parameters;
    const header = parameters?.find((p) => p.name === "Idempotency-Key" && p.in === "header");
    expect(header).toBeDefined();
    expect(header && header.name).toBe("Idempotency-Key");
    expect(header && header.required).not.toBe(true);
  });

  it("scopes the key by mentioning owner + operation in the header contract", () => {
    const parameters = usersOpenApi.paths["/v1/users/saved-routes"].post.parameters;
    const header = parameters?.find((p) => p.name === "Idempotency-Key" && p.in === "header");
    const description = header && header.description ? header.description : "";
    expect(description).toMatch(/owner/);
    expect(description).toMatch(/operation/);
  });

  it("advertises the typed 409 the retry contract returns under a reused key", () => {
    expect(usersOpenApi.paths["/v1/users/saved-routes"].post.responses["409"]).toBeDefined();
  });
});
