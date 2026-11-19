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

  it.each([
    { case: "an http URL on the image host", stored: "http://image.anitabi.cn/p.jpg" },
    { case: "a URL with a fragment", stored: "https://image.anitabi.cn/p.jpg#scene" },
  ])("pulls $case from its https URL on the origin, without the fragment", ({ stored }) => {
    expect(originPullUrl(stored, "h160")).toBe("https://image.anitabi.cn/p.jpg?plan=h160");
  });
});

describe("a stored image that names no URL on the image origin", () => {
  it.each([
    { case: "another host", stored: "https://photos.invalid/p.jpg" },
    { case: "userinfo ahead of another host", stored: "https://image.anitabi.cn@photos.invalid/p.jpg" },
    { case: "userinfo on the image host", stored: "https://ops@image.anitabi.cn/p.jpg" },
    { case: "a host that only begins with the image host", stored: "https://image.anitabi.cn.invalid/p.jpg" },
    { case: "a port on the image host", stored: "https://image.anitabi.cn:8443/p.jpg" },
    { case: "a scheme other than http and https", stored: "ftp://image.anitabi.cn/p.jpg" },
    { case: "a slash-less relative path", stored: "screenshot/p.jpg" },
  ])("gives no pull URL for $case: $stored", ({ stored }) => {
    expect(originPullUrl(stored, "h160")).toBeNull();
  });
});
