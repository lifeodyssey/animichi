import { describe, expect, it, vi } from "vitest";
import { chatSearchTarget, makeSearchHandler } from "../../../src/components/home/search-target";

describe("chatSearchTarget", () => {
  it("builds a /chat A2 target with the trimmed query", () => {
    expect(chatSearchTarget("  Your Name  ")).toEqual({ to: "/chat", search: { q: "Your Name" } });
  });

  it("returns null for a blank query so no navigation fires", () => {
    expect(chatSearchTarget("   ")).toBeNull();
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
