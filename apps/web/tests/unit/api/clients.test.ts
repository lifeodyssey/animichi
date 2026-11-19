import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { createCatalogClient, createUsersClient } from "../../../src/api/clients";
import { server } from "../../msw/node";
import { bangumiPointsFixture } from "../../msw/fixtures";

describe("createCatalogClient", () => {
  it("targets the configured catalog base URL", async () => {
    server.use(
      http.post("https://catalog.test/catalog/points-by-bangumi-id", () => HttpResponse.json(bangumiPointsFixture)),
    );
    const client = createCatalogClient({ url: "https://catalog.test" });
    const result = await client.pointsByBangumiId({ bangumi_id: "12345" });
    expect(result.rows[0]?.name).toBe("Hakone-Yumoto Station");
  });

  it("forwards auth headers from the per-call context", async () => {
    let seen: string | null = null;
    server.use(
      http.post("https://catalog.test/catalog/points-by-bangumi-id", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json(bangumiPointsFixture);
      }),
    );
    const client = createCatalogClient({ url: "https://catalog.test" });
    await client.pointsByBangumiId({ bangumi_id: "12345" }, { context: { headers: { authorization: "Bearer tok" } } });
    expect(seen).toBe("Bearer tok");
  });

  it("merges factory default headers with per-call context headers", async () => {
    const captured: Record<string, string | null> = {};
    server.use(
      http.post("https://catalog.test/catalog/points-by-bangumi-id", ({ request }) => {
        captured.trace = request.headers.get("x-trace");
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json(bangumiPointsFixture);
      }),
    );
    const client = createCatalogClient({ url: "https://catalog.test", headers: { "x-trace": "t1" } });
    await client.pointsByBangumiId({ bangumi_id: "12345" }, { context: { headers: { authorization: "Bearer tok" } } });
    expect(captured).toEqual({ trace: "t1", auth: "Bearer tok" });
  });
});

describe("createUsersClient", () => {
  it("resolves an async headers factory before every request", async () => {
    let seen: string | null = null;
    server.use(
      http.get("https://users.test/v1/users/saved-routes", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ saved_routes: [] });
      }),
    );
    const client = createUsersClient({
      url: "https://users.test",
      headers: () => Promise.resolve({ Authorization: "Bearer async-tok" }),
    });
    await client.listSavedRoutes();
    expect(seen).toBe("Bearer async-tok");
  });

  it("lets per-call context headers override the async factory default", async () => {
    let seen: string | null = null;
    server.use(
      http.get("https://users.test/v1/users/saved-routes", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ saved_routes: [] });
      }),
    );
    const client = createUsersClient({
      url: "https://users.test",
      headers: () => Promise.resolve({ Authorization: "Bearer default-tok" }),
    });
    await client.listSavedRoutes(undefined, { context: { headers: { Authorization: "Bearer override" } } });
    expect(seen).toBe("Bearer override");
  });
});
