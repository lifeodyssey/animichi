import { describe, expect, it } from "vitest";
import usersOpenApi from "../users-openapi.json";

const BEARER_SECURITY = [{ bearerAuth: [] }];
const HTTPS_PATTERN = "^[Hh][Tt][Tt][Pp][Ss]://";
const resolveSchema = usersOpenApi.paths["/v1/users/shares/resolve/{token}"]
  .get.responses["200"].content["application/json"].schema;
const itinerary = resolveSchema.properties.itinerary.properties;

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

  it("emits the HTTPS constraint for every public URL field", () => {
    const urls = [itinerary.stops.items.properties.frame_image_url,
      itinerary.comparisons.items.properties.image_url,
      itinerary.hero_image_url, itinerary.attributions.items.properties.url];
    expect(urls).toHaveLength(4);
    for (const schema of urls) {
      expect(schema).toMatchObject({ format: "uri", pattern: HTTPS_PATTERN });
    }
  });
});
