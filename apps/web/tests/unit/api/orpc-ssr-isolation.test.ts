import { describe, expect, it } from "vitest";
import { catalog, users } from "../../../src/api/orpc";

/**
 * Node environment (no `window`): the SSR path. Utils must be rebuilt per
 * call so the base URL follows each request's origin instead of whichever
 * accepted host happened to serve the first SSR request.
 */
describe("orpc utils on the server", () => {
  it("builds fresh catalog utils per call instead of caching the first origin", () => {
    expect(catalog()).not.toBe(catalog());
  });

  it("builds fresh users utils per call instead of caching the first origin", () => {
    expect(users()).not.toBe(users());
  });
});
