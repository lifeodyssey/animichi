import { describe, expect, it } from "vitest";
import { selectDueWorks, tiersFromConfig, workIsDue, type TieredWork } from "../src/ingest/tiers";

const CONFIG = tiersFromConfig({ high: 86_400_000, medium: 604_800_000, low: 2_592_000_000 });
const NOW = 2_000_000_000_000;

function work(id: string, tier: TieredWork["tier"], last: number | null): TieredWork {
  return { bangumiId: id, tier, lastIngestedAtMs: last };
}

describe("Refresh tiers (AC3)", () => {
  it("derives tier configs from caller intervals with explicit priority", () => {
    expect(CONFIG.high.priority).toBe(1);
    expect(CONFIG.low.priority).toBe(3);
    expect(CONFIG.high.refreshIntervalMs).toBe(86_400_000);
  });

  it("treats a never-ingested work as immediately due", () => {
    expect(workIsDue(work("a", "high", null), CONFIG, NOW)).toBe(true);
  });

  it("marks a work stale exactly when its last ingest reaches the interval", () => {
    const fresh = work("a", "high", NOW - 1_000);
    const stale = work("b", "high", NOW - 86_400_000);
    expect(workIsDue(fresh, CONFIG, NOW)).toBe(false);
    expect(workIsDue(stale, CONFIG, NOW)).toBe(true);
  });

  it("selects due works in tier-priority order then source order", () => {
    const works = [
      work("low1", "low", NOW - 3_000_000_000),
      work("high1", "high", NOW - 1_000_000_000),
      work("med1", "medium", null),
      work("high2", "high", NOW - 90_000_000),
    ];
    const selected = selectDueWorks(works, CONFIG, NOW, 10);
    expect(selected.map((d) => d.bangumiId)).toEqual(["high1", "high2", "med1", "low1"]);
  });

  it("caps the selection to the work budget", () => {
    const works = [work("a", "high", null), work("b", "high", null), work("c", "high", null)];
    expect(selectDueWorks(works, CONFIG, NOW, 2)).toHaveLength(2);
  });

  it("never emits a duplicate id and drops non-positive caps", () => {
    expect(selectDueWorks([work("a", "high", null), work("a", "high", null)], CONFIG, NOW, 5)).toHaveLength(1);
    expect(selectDueWorks([work("a", "high", null)], CONFIG, NOW, 0)).toEqual([]);
  });
});
