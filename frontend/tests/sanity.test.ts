import { describe, it, expect } from "vitest";
import type { SearchResultData } from "@/lib/types";
import {
  SEARCH_RESPONSE,
  EMPTY_SEARCH_RESPONSE,
  ERROR_RESPONSE,
} from "./fixtures/responses";

describe("vitest sanity", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("fixtures have correct shape", () => {
    expect(SEARCH_RESPONSE.success).toBe(true);
    expect(SEARCH_RESPONSE.intent).toBe("search_bangumi");
    const data = SEARCH_RESPONSE.data as SearchResultData;
    expect(data.results.status).toBe("ok");
  });

  it("empty response has zero rows", () => {
    const data = EMPTY_SEARCH_RESPONSE.data as SearchResultData;
    expect(data.results.status).toBe("empty");
    expect(EMPTY_SEARCH_RESPONSE.status).toBe("empty");
  });

  it("error response has errors array", () => {
    expect(ERROR_RESPONSE.success).toBe(false);
    expect(ERROR_RESPONSE.errors).toHaveLength(1);
    expect(ERROR_RESPONSE.errors[0]?.code).toBe("INTERNAL_ERROR");
  });
});
