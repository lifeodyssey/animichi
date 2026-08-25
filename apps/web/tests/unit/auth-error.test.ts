import { describe, expect, it } from "vitest";
import { authErrorMessage } from "../../src/lib/auth/auth-error";

describe("authErrorMessage", () => {
  it("reads the message off a rejected Error", () => {
    expect(authErrorMessage(new Error("network"))).toBe("network");
  });

  it("reads the message off a resolved SDK error envelope", () => {
    expect(authErrorMessage({ message: "Unauthorized" })).toBe("Unauthorized");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "boom"],
    ["an envelope with no message", {}],
    ["an envelope whose message is not a string", { message: 42 }],
  ])("has no message to show for %s", (_name, error) => {
    expect(authErrorMessage(error)).toBe("");
  });
});
