import { describe, expect, it } from "vitest";
import {
  isIntentOnly,
  parseChatDataPart,
} from "../../../src/features/chat/data-parts";

describe("parseChatDataPart", () => {
  it("parses an intent-first frame", () => {
    const part = parseChatDataPart({ intent: "plan_route" });
    expect(part?.intent).toBe("plan_route");
  });

  it("parses a full plan_route envelope", () => {
    const part = parseChatDataPart({
      intent: "plan_route",
      success: true,
      message: "宇治の聖地を2件",
      data: { route: { point_count: 2, total_walk_minutes: 12 } },
    });
    expect(part?.message).toBe("宇治の聖地を2件");
  });

  it("rejects an unknown intent", () => {
    expect(parseChatDataPart({ intent: "hack_the_planet" })).toBeNull();
  });

  it("rejects an envelope with unexpected extra keys", () => {
    expect(
      parseChatDataPart({ intent: "greet_user", data: { injected: true } }),
    ).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseChatDataPart("nope")).toBeNull();
    expect(parseChatDataPart(null)).toBeNull();
  });
});

describe("isIntentOnly", () => {
  it("is true for the intent-first frame", () => {
    const part = parseChatDataPart({ intent: "search_bangumi" });
    expect(part && isIntentOnly(part)).toBe(true);
  });

  it("is false once the envelope fills in", () => {
    const part = parseChatDataPart({ intent: "greet_user", message: "こんにちは" });
    expect(part && isIntentOnly(part)).toBe(false);
  });
});
