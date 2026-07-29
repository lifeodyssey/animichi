import { describe, expect, it } from "vitest";
import { shioriLabels } from "../../../src/features/shiori/labels";
import type { ShioriCompletion, ShioriStats } from "../../../src/features/shiori/compose";

const STATS: ShioriStats = { walkMinutes: 210, distanceKm: 2.8, timeWindow: "09:31→12:58" };
const COMPLETION: ShioriCompletion = { checkedCount: 2, stopCount: 2, ratePercent: 100 };

describe("shioriLabels mode names", () => {
  it.each([
    ["ja", "計画しおり", "完走記念しおり"],
    ["zh", "行程计划书签", "完走纪念书签"],
    ["en", "Planned shiori", "Commemorative shiori"],
  ] as const)("names both modes in %s", (locale, planned, commemorative) => {
    const labels = shioriLabels(locale);

    expect(labels.modeName.planned).toBe(planned);
    expect(labels.modeName.commemorative).toBe(commemorative);
  });
});

describe("shioriLabels stats line", () => {
  it.each([
    ["ja", "徒歩210分 · 2.8km · 09:31→12:58"],
    ["zh", "步行210分 · 2.8km · 09:31→12:58"],
    ["en", "210 min walk · 2.8 km · 09:31→12:58"],
  ] as const)("renders the stats copy in %s", (locale, expected) => {
    expect(shioriLabels(locale).statsLine(STATS)).toBe(expected);
  });

  it("omits the time window when the itinerary has no stops", () => {
    const stats: ShioriStats = { ...STATS, timeWindow: null };

    expect(shioriLabels("ja").statsLine(stats)).toBe("徒歩210分 · 2.8km");
  });
});

describe("shioriLabels completion line", () => {
  it.each([
    ["ja", "完走 2/2 · 100%"],
    ["zh", "完走 2/2 · 100%"],
    ["en", "Completed 2/2 · 100%"],
  ] as const)("renders the completion copy in %s", (locale, expected) => {
    expect(shioriLabels(locale).completionLine(COMPLETION)).toBe(expected);
  });
});

describe("shioriLabels EXIF opt-in", () => {
  it.each([
    ["ja", "写真の位置情報（EXIF）を残す"],
    ["zh", "保留照片位置信息（EXIF）"],
    ["en", "Keep photo location data (EXIF)"],
  ] as const)("labels the retain-EXIF opt-in in %s", (locale, expected) => {
    expect(shioriLabels(locale).retainExif).toBe(expected);
  });
});
