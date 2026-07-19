import { describe, expect, it } from "vitest";
import usersOpenApi from "../users-openapi.json";

const BEARER_SECURITY = [{ bearerAuth: [] }];

describe("users OpenAPI security", () => {
  it("defines HTTP bearer JWT authentication", () => {
    expect(usersOpenApi.components.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    });
  });

  it("requires bearer authentication for users, check-in, and share mutations", () => {
    expect(usersOpenApi.paths["/v1/users/routes"].get.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/routes"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/routes/{id}"].delete.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/routes/claim"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/checkins"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/checkins"].get.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/shares"].post.security).toEqual(BEARER_SECURITY);
    expect(usersOpenApi.paths["/v1/users/shares/{share_id}"].delete.security).toEqual(BEARER_SECURITY);
  });

  it("marks public share resolution as explicitly anonymous", () => {
    const resolve = usersOpenApi.paths["/v1/users/shares/resolve/{token}"].get;
    expect(resolve.security).toEqual([]);
  });
});
