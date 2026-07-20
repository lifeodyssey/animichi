import { describe, expect, it } from "vitest";
import { pickMood } from "../../../src/features/chat/mood";

describe("pickMood", () => {
  it("returns a quote and its source for a recognised title", () => {
    const mood = pickMood("ユーフォニアムの聖地に行きたい");
    expect(mood?.source).toContain("ユーフォニアム");
    expect(mood?.quote.length).toBeGreaterThan(0);
  });

  it("returns undefined when no title matches the waiting text", () => {
    expect(pickMood("近くの聖地をさがして")).toBeUndefined();
  });
});
