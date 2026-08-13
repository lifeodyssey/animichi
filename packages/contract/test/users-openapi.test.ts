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

  it("requires bearer authentication for every saved-route mutation", () => {
    expect(usersOpenApi.paths["/v1/users/saved-routes"].get.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/saved-routes"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/saved-routes/{id}"].delete.security).toEqual(BEARER_SECURITY);
  });
});
