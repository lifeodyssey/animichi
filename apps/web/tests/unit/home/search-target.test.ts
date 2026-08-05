import { describe, expect, it, vi } from "vitest";
import { chatSearchPath, chatSearchTarget, makeSearchHandler } from "../../../src/components/home/search-target";

describe("chatSearchTarget", () => {
  it("builds a /chat A2 target with the trimmed query", () => {
    expect(chatSearchTarget("  Your Name  ")).toEqual({ to: "/chat", search: { q: "Your Name" } });
  });

  it("returns null for a blank query so no navigation fires", () => {
    expect(chatSearchTarget("   ")).toBeNull();
  });
});

describe("chatSearchPath", () => {
  it("serializes a query to an encoded /chat?q= path for the landing return-target", () => {
    expect(chatSearchPath("  Your Name  ")).toBe("/chat?q=Your%20Name");
  });

  it("percent-encodes non-ASCII queries so ?q= survives the mailed link", () => {
    expect(chatSearchPath("君の名は。")).toBe(`/chat?q=${encodeURIComponent("君の名は。")}`);
  });

  it("returns undefined for a blank query so no return target rides the login", () => {
    expect(chatSearchPath("")).toBeUndefined();
    expect(chatSearchPath("   ")).toBeUndefined();
  });
});

describe("makeSearchHandler", () => {
  it("navigates to the chat target for a real query", () => {
    const navigate = vi.fn();
    makeSearchHandler(navigate)("Euphonium");
    expect(navigate).toHaveBeenCalledWith({ to: "/chat", search: { q: "Euphonium" } });
  });

  it("does not navigate when the query is blank", () => {
    const navigate = vi.fn();
    makeSearchHandler(navigate)("");
    expect(navigate).not.toHaveBeenCalled();
  });
});
