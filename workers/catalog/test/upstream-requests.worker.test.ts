import { describe, expect, it } from "vitest";
import {
  ANITABI_EGRESS_BASE_URL,
  egressPathFor,
  type AnitabiOperation,
} from "../src/ingest/anitabi-egress";
import {
  upstreamNameOf,
  upstreamUrlFor,
  validateBangumiId,
  type UpstreamRequest,
} from "../src/ingest/upstream-requests";
import { fetchJson, type FetchLike } from "../src/ingest/sources";
import { mockFetch } from "./mock-fetch-sequence";

/**
 * The request surface (#1792). Two things are asserted here, and neither is
 * "both endpoints work":
 *
 *  1. the *type surface* — the chokepoint takes an enumerated request and never
 *     a URL, and the anitabi operation set is exactly the two the egress
 *     service exposes. Both are compile-time assertions: this file is
 *     typechecked with the package, so restoring a `url: string` parameter or
 *     adding a third operation turns `tsc` red before any test runs.
 *  2. the *built values* — every input, including adversarial ids, produces a
 *     URL the capture permits, because the id is the only free variable.
 */

/** The first parameter of a function type. */
type FirstParameter<F> = F extends (first: infer P, ...rest: never[]) => unknown ? P : never;

/** True when the function would accept a bare URL string as its first argument. */
type UrlIsAccepted<F> = Extract<FirstParameter<F>, string> extends never ? false : true;

/** True when the operation union is exactly `P` — no member beyond it. */
type OperationsAreExactly<P extends AnitabiOperation> = Exclude<AnitabiOperation, P> extends never ? true : false;

describe("the type surface: a request, never a URL", () => {
  it("fetchJson cannot be called with a URL", () => {
    const urlIsAccepted: UrlIsAccepted<typeof fetchJson> = false;
    expect(urlIsAccepted).toBe(false);
  });

  it("accepts exactly the two anitabi operations, with no third", () => {
    const exactlyTwo: OperationsAreExactly<"points" | "lite"> = true;
    expect(exactlyTwo).toBe(true);
  });
});

describe("the expressible anitabi surface", () => {
  it("builds both operations under the one egress address", () => {
    expect(egressPathFor("points", "2461")).toBe("/anitabi/points/2461");
    expect(egressPathFor("lite", "10380")).toBe("/anitabi/lite/10380");
  });

  it("never names the upstream — the service is the only path to it", () => {
    for (const operation of ["points", "lite"] as const) {
      const url = upstreamUrlFor({ upstream: "anitabi", operation, bangumiId: "2461" }, "");
      expect(url.startsWith(ANITABI_EGRESS_BASE_URL)).toBe(true);
      expect(url).not.toContain("anitabi.cn");
    }
  });

  it("refuses every id that is not a positive integer, before any URL exists", () => {
    const refused = ["", "0", "007", "-1", "1.5", "1e3", "2461abc", "abc/123", "../etc", " ", "1 2", "９９"];
    for (const id of refused) {
      expect(() => validateBangumiId(id)).toThrow("Invalid bangumi_id");
      expect(() => upstreamUrlFor({ upstream: "anitabi", operation: "points", bangumiId: id }, "")).toThrow(
        "Invalid bangumi_id",
      );
    }
  });

  it("admits a positive integer, and produces a path carrying only that id", () => {
    expect(validateBangumiId("2461")).toBe("2461");
    expect(upstreamUrlFor({ upstream: "anitabi", operation: "lite", bangumiId: "2461" }, "")).toBe(
      `${ANITABI_EGRESS_BASE_URL}/anitabi/lite/2461`,
    );
  });

  it("enumerates the whole input space of the anitabi builder without escaping it", () => {
    const ids = ["1", "2461", "999999999999999"];
    const operations = ["points", "lite"] as const;
    const built = operations.flatMap((operation) =>
      ids.map((bangumiId) => upstreamUrlFor({ upstream: "anitabi", operation, bangumiId }, "")));
    expect(built).toEqual([
      `${ANITABI_EGRESS_BASE_URL}/anitabi/points/1`,
      `${ANITABI_EGRESS_BASE_URL}/anitabi/points/2461`,
      `${ANITABI_EGRESS_BASE_URL}/anitabi/points/999999999999999`,
      `${ANITABI_EGRESS_BASE_URL}/anitabi/lite/1`,
      `${ANITABI_EGRESS_BASE_URL}/anitabi/lite/2461`,
      `${ANITABI_EGRESS_BASE_URL}/anitabi/lite/999999999999999`,
    ]);
  });
});

describe("the enumerated bangumi requests", () => {
  it("builds the subject, calendar, and bounded search URLs", () => {
    const base = "https://bgm.test";
    expect(upstreamUrlFor({ upstream: "bangumi", operation: "subject", bangumiId: "276" }, base)).toBe(
      `${base}/v0/subjects/276`,
    );
    expect(upstreamUrlFor({ upstream: "bangumi", operation: "calendar" }, base)).toBe(`${base}/calendar`);
    expect(upstreamUrlFor({ upstream: "bangumi", operation: "search-subjects", limit: 8 }, base)).toBe(
      `${base}/v0/search/subjects?limit=8&offset=0`,
    );
  });

  it("refuses a search page size that is not a positive integer", () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() => upstreamUrlFor({ upstream: "bangumi", operation: "search-subjects", limit }, "https://bgm.test")).toThrow(
        "Bangumi search limit must be a positive integer",
      );
    }
  });

  it("names the upstream each request belongs to, for the failure taxonomy", () => {
    const requests: UpstreamRequest[] = [
      { upstream: "anitabi", operation: "lite", bangumiId: "1" },
      { upstream: "bangumi", operation: "subject", bangumiId: "1" },
      { upstream: "bangumi", operation: "calendar" },
      { upstream: "bangumi", operation: "search-subjects", limit: 1 },
    ];
    expect(requests.map(upstreamNameOf)).toEqual(["anitabi", "bangumi", "bangumi", "bangumi"]);
  });
});

describe("fetchJson over a request", () => {
  it("fetches the URL its request names, with the shared User-Agent", async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const fetch: FetchLike = (url, init) => {
      seen.push({ url, headers: init?.headers });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 276 }) });
    };
    await fetchJson({ upstream: "bangumi", operation: "subject", bangumiId: "276" }, { fetchImpl: fetch });
    expect(seen[0]?.url).toBe("https://api.bgm.tv/v0/subjects/276");
    expect(seen[0]?.headers?.["User-Agent"]).toBe("Animichi/1.0 (https://github.com/lifeodyssey/animichi)");
  });

  it("refuses a request whose id cannot be validated, without fetching", async () => {
    const { fetch, urls } = mockFetch({});
    await expect(
      fetchJson({ upstream: "bangumi", operation: "subject", bangumiId: "abc" }, { fetchImpl: fetch }),
    ).rejects.toThrow("Invalid bangumi_id");
    expect(urls).toEqual([]);
  });
});
