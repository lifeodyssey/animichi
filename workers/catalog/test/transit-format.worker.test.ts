import { describe, expect, it } from "vitest";
import { formatTransitSummary, type TransitEstimate } from "../src/lib/transit";

const estimate = (overrides: Partial<TransitEstimate>): TransitEstimate => ({ board_station_name: "新宿", alight_station_name: "吉祥寺", line_names: ["中央線"], transfers: 0, rail_minutes: 17, wait_minutes: 4, access_walk_minutes: 0, egress_walk_minutes: 0, total_minutes: 21, distance_m: 12000, ...overrides });

describe("formatTransitSummary", () => {
  it("formats a direct trip exactly", () => {
    expect(formatTransitSummary(estimate({}))).toBe("新宿駅→吉祥寺駅:中央線,約21分・乗換0回");
  });

  it("formats a one-transfer trip and preserves an existing suffix", () => {
    const value = estimate({ board_station_name: "品川駅", line_names: ["山手線", "中央線快速"], transfers: 1, total_minutes: 37 });
    expect(formatTransitSummary(value)).toBe("品川駅→吉祥寺駅:山手線→中央線快速,約37分・乗換1回");
  });
});
