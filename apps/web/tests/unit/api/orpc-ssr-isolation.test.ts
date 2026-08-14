import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog, users } from "../../../src/api/orpc";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";

/**
 * Node environment (no `window`): the SSR path. Utils must be rebuilt per
 * call so the base URL follows each request's origin instead of whichever
 * accepted host happened to serve the first SSR request.
 */
describe("orpc utils on the server", () => {
  beforeEach(() => {
    // A well-formed server config: outside a request context `resolveOrigin`
    // fails loud (no api.siteOrigin, no request URL), so the freshness
    // checks below need the explicit override from the runtime config (#1013).
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, {
      ...DEFAULT_RUNTIME_CONFIG,
      api: { siteOrigin: "https://ssr.test" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("builds fresh catalog utils per call instead of caching the first origin", () => {
    expect(catalog()).not.toBe(catalog());
  });

  it("builds fresh users utils per call instead of caching the first origin", () => {
    expect(users()).not.toBe(users());
  });
});
