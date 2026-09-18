import { describe, expect, it } from "vitest";
import { ANITABI_USER_AGENT, parseAnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { originPullUrl } from "../src/media/img";

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
