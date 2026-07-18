import { describe, expect, it } from "vitest";
import { buildFactSummary, rankScenes } from "../../../src/features/anime/fact-summary";
import { emptyOverviewFixture, fullOverviewFixture } from "../../msw/anime-overview";

describe("buildFactSummary", () => {
  it("passes the spot count through from points_length", () => {
    expect(buildFactSummary(fullOverviewFixture).spotCount).toBe(6);
  });

  it("ranks the top-3 cities by spot count, descending", () => {
    expect(buildFactSummary(fullOverviewFixture).topCities).toEqual([
      { region: "Takayama", count: 3 },
      { region: "Tokyo", count: 2 },
      { region: "Hida", count: 1 },
    ]);
  });

  it("estimates the pilgrimage duration from the largest sample route", () => {
    // 3 stops: 3 * 8 dwell-floor minutes + 2 * 15 walk-buffer minutes = 54.
    expect(buildFactSummary(fullOverviewFixture).durationMinutes).toBe(54);
  });

  it("reports a null duration when there are no sample routes", () => {
    expect(buildFactSummary(emptyOverviewFixture("404404")).durationMinutes).toBeNull();
  });

  it("counts the sample routes", () => {
    expect(buildFactSummary(fullOverviewFixture).routeCount).toBe(2);
  });
});

describe("rankScenes", () => {
  it("orders scenes by shot count, descending", () => {
    const ranked = rankScenes(fullOverviewFixture.scenes);
    expect(ranked.map((scene) => scene.shot_count)).toEqual([5, 2]);
  });
});
