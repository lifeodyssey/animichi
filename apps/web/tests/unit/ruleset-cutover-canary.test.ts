import { expect, it } from "vitest";

it("deliberately fails the #1180 PR Verification canary", () => {
  expect("blocked").toBe("eligible");
});
