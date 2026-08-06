import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog, users } from "../../../src/api/orpc";

/**
 * Node environment (no `window`): the SSR path. Utils must be rebuilt per
 * call so the base URL follows each request's origin instead of whichever
 * accepted host happened to serve the first SSR request.
 */
describe("orpc utils on the server", () => {
  beforeEach(() => {
    // A well-formed server config: outside a request context `resolveOrigin`
    // fails loud (no VITE_SITE_ORIGIN, no request URL), so the freshness
    // checks below need the explicit override.
    vi.stubEnv("VITE_SITE_ORIGIN", "https://ssr.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("builds fresh catalog utils per call instead of caching the first origin", () => {
    expect(catalog()).not.toBe(catalog());
  });

  it("builds fresh users utils per call instead of caching the first origin", () => {
    expect(users()).not.toBe(users());
  });
});
