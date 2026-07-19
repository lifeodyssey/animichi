/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { catalog, users } from "../../../src/api/orpc";

/** Browser environment: one origin for the whole page, memoization is safe. */
describe("orpc utils in the browser", () => {
  it("memoizes the catalog utils across calls", () => {
    expect(catalog()).toBe(catalog());
  });

  it("memoizes the users utils across calls", () => {
    expect(users()).toBe(users());
  });
});
