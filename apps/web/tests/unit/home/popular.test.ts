/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { popularRankingOptions } from "../../../src/api/hooks/use-popular";
import { server } from "../../msw/node";
import { popularEmptyHandler, popularErrorHandler, popularHandler } from "../../msw/popular";

describe("usePopularRanking options", () => {
  it("keys the ranking query by the requested limit", () => {
    expect(popularRankingOptions(5).queryKey).toEqual(["catalog", "popular", 5]);
  });

  it("routes through the catalog popular procedure", () => {
    const options = popularRankingOptions();
    expect(options.queryFn).toBeTypeOf("function");
  });
});

describe("catalog popular procedure (via MSW)", () => {
  it("parses the catalog popular payload into contract-shaped rows", async () => {
    server.use(popularHandler);
    const options = popularRankingOptions();
    const result = await options.queryFn({ queryKey: options.queryKey, signal: undefined as never, client: undefined as never, meta: undefined });
    expect(result.bangumi.map((b) => b.title)).toEqual(["Your Name", "Euphonium"]);
    expect(result.bangumi[0]?.points_count).toBe(12);
  });

  it("returns an empty list when the catalog has no popular titles", async () => {
    server.use(popularEmptyHandler);
    const options = popularRankingOptions();
    const result = await options.queryFn({ queryKey: options.queryKey, signal: undefined as never, client: undefined as never, meta: undefined });
    expect(result.bangumi).toEqual([]);
  });

  it("throws when the endpoint fails so the query surfaces an error", async () => {
    server.use(popularErrorHandler);
    const options = popularRankingOptions();
    await expect(options.queryFn({ queryKey: options.queryKey, signal: undefined as never, client: undefined as never, meta: undefined })).rejects.toThrow();
  });
});
