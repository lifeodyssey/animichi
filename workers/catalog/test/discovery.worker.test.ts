import { describe, expect, it } from "vitest";
import { dailyRunKey, mergeDiscovery, type DiscoveryInput } from "../src/ingest/discovery";

const season: DiscoveryInput = { source: "current_season", bangumiIds: ["1", "2", "3"] };
const popular: DiscoveryInput = { source: "popularity", bangumiIds: ["3", "4", "5"] };
const historic: DiscoveryInput = { source: "historical", bangumiIds: ["6", "7"] };

describe("Daily discovery merge (AC2)", () => {
  it("merges current-season, popularity, and historical inputs", () => {
    const result = mergeDiscovery(new Set(), [season, popular, historic], 10);
    expect(result.works.map((w) => w.bangumiId)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(result.uniqueSeen).toBe(7);
    expect(result.newCount).toBe(7);
    expect(result.cappedCount).toBe(0);
  });

  it("deduplicates deterministically and appends the source to duplicates", () => {
    const result = mergeDiscovery(new Set(), [season, popular], 10);
    const three = result.works.find((w) => w.bangumiId === "3");
    expect(three?.sources).toEqual(["current_season", "popularity"]);
    expect(result.works).toHaveLength(5);
  });

  it("never counts known works against the daily growth cap", () => {
    const known = new Set(["1", "2", "3"]);
    const result = mergeDiscovery(known, [season, popular, historic], 2);
    // 3 known + 2 new admitted (4,5) + 2 new capped (6,7).
    expect(result.works.map((w) => w.bangumiId)).toEqual(["1", "2", "3", "4", "5"]);
    expect(result.newCount).toBe(2);
    expect(result.cappedCount).toBe(2);
    expect(result.knownCount).toBe(3);
    expect(result.uniqueSeen).toBe(7);
  });

  it("drops repeated ids within one input without double-counting", () => {
    const dup = { source: "popularity" as const, bangumiIds: ["9", "9", "10"] };
    const result = mergeDiscovery(new Set(), [dup], 10);
    expect(result.works.map((w) => w.bangumiId)).toEqual(["9", "10"]);
    expect(result.uniqueSeen).toBe(2);
  });

  it("is order-stable (same inputs yield the same target set)", () => {
    const a = mergeDiscovery(new Set(), [season, popular, historic], 10);
    const b = mergeDiscovery(new Set(), [season, popular, historic], 10);
    expect(a.works.map((w) => w.bangumiId)).toEqual(b.works.map((w) => w.bangumiId));
  });

  it("rejects a negative growth cap", () => {
    expect(() => mergeDiscovery(new Set(), [season], -1)).toThrow(/newWorkCap/);
  });
});

describe("dailyRunKey", () => {
  it("derives a stable UTC date key", () => {
    expect(dailyRunKey(1_723_000_000_000)).toMatch(/^daily-\d{4}-\d{2}-\d{2}$/);
    expect(dailyRunKey(1_723_000_000_000)).toBe(dailyRunKey(1_723_000_000_000));
  });
});
