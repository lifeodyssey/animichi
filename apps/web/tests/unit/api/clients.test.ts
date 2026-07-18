import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { createCatalogClient } from "../../../src/api/clients";
import { server } from "../../msw/node";
import { searchSuccessFixture } from "../../msw/fixtures";

describe("createCatalogClient", () => {
  it("targets the configured catalog base URL", async () => {
    server.use(
      http.post("https://catalog.test/catalog/search", () => HttpResponse.json(searchSuccessFixture)),
    );
    const client = createCatalogClient({ url: "https://catalog.test" });
    const result = await client.search({ query: "hakone" });
    expect(result.rows[0]?.name).toBe("Hakone-Yumoto Station");
  });

  it("forwards auth headers from the per-call context", async () => {
    let seen: string | null = null;
    server.use(
      http.post("https://catalog.test/catalog/search", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json(searchSuccessFixture);
      }),
    );
    const client = createCatalogClient({ url: "https://catalog.test" });
    await client.search({ query: "hakone" }, { context: { headers: { authorization: "Bearer tok" } } });
    expect(seen).toBe("Bearer tok");
  });

  it("merges factory default headers with per-call context headers", async () => {
    const captured: Record<string, string | null> = {};
    server.use(
      http.post("https://catalog.test/catalog/search", ({ request }) => {
        captured.trace = request.headers.get("x-trace");
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json(searchSuccessFixture);
      }),
    );
    const client = createCatalogClient({ url: "https://catalog.test", headers: { "x-trace": "t1" } });
    await client.search({ query: "hakone" }, { context: { headers: { authorization: "Bearer tok" } } });
    expect(captured).toEqual({ trace: "t1", auth: "Bearer tok" });
  });
});
