import { describe, expect, it } from "vitest";
import { ANITABI_USER_AGENT, parseAnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { originPullUrl } from "../src/media/image-origin";

/**
 * The URL a point photo is pulled from (`src/media/image-origin.ts`), and the
 * size plan and user agent every pull carries.
 */

describe("public display image pulls", () => {
  it("refuses a full-resolution request that omitted the plan", () => {
    expect(parseAnitabiImagePlan(undefined)).toBeNull();
    expect(parseAnitabiImagePlan(null)).toBeNull();
  });

  it("asks Anitabi for the size the surface requested", () => {
    expect(originPullUrl("https://image.anitabi.cn/p.jpg", "h160"))
      .toBe("https://image.anitabi.cn/p.jpg?plan=h160");
    expect(originPullUrl("/2024/p.jpg", "h360"))
      .toBe("https://image.anitabi.cn/2024/p.jpg?plan=h360");
  });

  it("uses the same user agent as every other Anitabi request", () => {
    expect(ANITABI_USER_AGENT).toBe("Animichi/1.0 (https://github.com/lifeodyssey/animichi)");
  });
});

describe("the pull URL of a stored image on the image origin", () => {
  it.each([
    { stored: "/p.jpg", plan: "h160", pulled: "https://image.anitabi.cn/p.jpg?plan=h160" },
    { stored: "//photos.invalid/p.jpg", plan: "h160", pulled: "https://image.anitabi.cn//photos.invalid/p.jpg?plan=h160" },
    { stored: "/\\photos.invalid/p.jpg", plan: "h160", pulled: "https://image.anitabi.cn//photos.invalid/p.jpg?plan=h160" },
    { stored: "https://image.anitabi.cn:443/p.jpg", plan: "h160", pulled: "https://image.anitabi.cn/p.jpg?plan=h160" },
    { stored: "https://image.anitabi.cn/p.jpg?v=2", plan: "h160", pulled: "https://image.anitabi.cn/p.jpg?v=2&plan=h160" },
    { stored: "https://image.anitabi.cn/p.jpg?plan=h160", plan: "h360", pulled: "https://image.anitabi.cn/p.jpg?plan=h360" },
  ] as const)("pulls $stored at $plan from $pulled, on image.anitabi.cn", ({ stored, plan, pulled }) => {
    expect(originPullUrl(stored, plan)).toBe(pulled);
  });
});
