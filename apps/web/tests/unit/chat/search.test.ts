import { describe, expect, it } from "vitest";
import { parseChatSearch } from "../../../src/features/chat/search";

describe("parseChatSearch", () => {
  it("keeps non-empty string params", () => {
    const search = parseChatSearch({ q: "ユーフォ", session: "s-1", route: "r-1" });
    expect(search).toEqual({ q: "ユーフォ", session: "s-1", route: "r-1" });
  });

  it("drops empty strings and non-string values", () => {
    const search = parseChatSearch({ q: "", session: 42, route: undefined });
    expect(search).toEqual({ q: undefined, session: undefined, route: undefined });
  });

  it("ignores unknown params", () => {
    expect(parseChatSearch({ evil: "x" })).toEqual({
      q: undefined,
      session: undefined,
      route: undefined,
    });
  });
});
