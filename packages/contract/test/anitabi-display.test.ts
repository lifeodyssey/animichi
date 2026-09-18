import { describe, expect, it } from "vitest";
import type { Point } from "../src/models.ts";
import {
  ANITABI_ATTRIBUTION,
  ANITABI_LICENSE_URL,
  ANITABI_MOBILE_PLAN,
  ANITABI_THUMBNAIL_PLAN,
  ANITABI_USER_AGENT,
  parseAnitabiImagePlan,
  withAnitabiImagePlan,
} from "../src/anitabi-display.ts";

function screenshotCredit(point: Point): { origin: string | undefined; originUrl: string | undefined } {
  return { origin: point.origin, originUrl: point.origin_url };
}

describe("Anitabi display constants", () => {
  it("records licence, attribution, and user-agent in one place", () => {
    expect(ANITABI_ATTRIBUTION).toBe("Anitabi");
    expect(ANITABI_LICENSE_URL).toBe("https://creativecommons.org/licenses/by-nc-sa/4.0/");
    expect(ANITABI_USER_AGENT).toBe("Animichi/1.0 (https://github.com/lifeodyssey/animichi)");
  });
});

describe("Point origin fields the browser surface consumes", () => {
  it("exposes origin and origin_url on the point shape", () => {
    const credit = screenshotCredit({
      id: "al3yeri",
      name: "宇治橋",
      bangumi_id: "10380",
      screenshot_url: "https://image.anitabi.cn/p.jpg",
      latitude: 34.89,
      longitude: 135.8,
      origin: "バンダイチャンネル",
      origin_url: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
    });
    expect(credit).toEqual({
      origin: "バンダイチャンネル",
      originUrl: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
    });
  });
});

describe("Anitabi image plans", () => {
  it("refuses a full-resolution request (no plan) on a public display path", () => {
    expect(parseAnitabiImagePlan(undefined)).toBeNull();
    expect(parseAnitabiImagePlan(null)).toBeNull();
    expect(parseAnitabiImagePlan("")).toBeNull();
    expect(parseAnitabiImagePlan("original")).toBeNull();
  });

  it("accepts only the documented thumbnail and mobile plans", () => {
    expect(parseAnitabiImagePlan(ANITABI_THUMBNAIL_PLAN)).toBe("h160");
    expect(parseAnitabiImagePlan(ANITABI_MOBILE_PLAN)).toBe("h360");
  });

  it("derives the size from the surface that asks, not a fetch default", () => {
    const base = "https://image.anitabi.cn/bangumi/1/p.jpg";
    expect(withAnitabiImagePlan(base, ANITABI_THUMBNAIL_PLAN)).toBe(`${base}?plan=h160`);
    expect(withAnitabiImagePlan(base, ANITABI_MOBILE_PLAN)).toBe(`${base}?plan=h360`);
  });

  it("applies the plan to a proxied relative screenshot path", () => {
    expect(withAnitabiImagePlan("/img/bangumi/1/p.jpg", ANITABI_THUMBNAIL_PLAN))
      .toBe("/img/bangumi/1/p.jpg?plan=h160");
  });
});
