/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { fetchPopular, popularUrl } from "../../../src/api/popular";
import { popularRankingOptions } from "../../../src/api/hooks/use-popular";
import { server } from "../../msw/node";
import { popularEmptyHandler, popularErrorHandler, popularHandler } from "../../msw/popular";

describe("fetchPopular", () => {
  it("parses the agent popular payload into contract-shaped rows", async () => {
    server.use(popularHandler);
    const result = await fetchPopular();
    expect(result.bangumi.map((b) => b.title)).toEqual(["Your Name", "Euphonium"]);
    expect(result.bangumi[0]?.points_count).toBe(12);
  });

  it("returns an empty list when the catalog has no popular titles", async () => {
    server.use(popularEmptyHandler);
    const result = await fetchPopular();
    expect(result.bangumi).toEqual([]);
  });

  it("throws when the endpoint fails so the query surfaces an error", async () => {
    server.use(popularErrorHandler);
    await expect(fetchPopular()).rejects.toThrow("popular request failed: 500");
  });

  it("builds the popular URL with an explicit limit", () => {
    expect(popularUrl(5)).toBe("http://localhost:3000/v1/bangumi/popular?limit=5");
  });

  it("keys the ranking query by the requested limit", () => {
    expect(popularRankingOptions(5).queryKey).toEqual(["popular", 5]);
  });
});
