import { describe, expect, it } from "vitest";
import { makeQueryClient } from "../../../src/api/query-client";

describe("makeQueryClient", () => {
  it("returns a fresh client per call so requests never share a cache", () => {
    const first = makeQueryClient();
    const second = makeQueryClient();
    expect(first).not.toBe(second);
    expect(first.getQueryCache()).not.toBe(second.getQueryCache());
  });

  it("applies a shared default query staleTime", () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  it("keeps a value cached in one client invisible to another", () => {
    const first = makeQueryClient();
    const second = makeQueryClient();
    first.setQueryData(["catalog", "search"], { rows: [] });
    expect(first.getQueryData(["catalog", "search"])).toEqual({ rows: [] });
    expect(second.getQueryData(["catalog", "search"])).toBeUndefined();
  });
});
