import { describe, expect, it } from "vitest";
import { resolveApiConfig, resolveOrigin } from "../../../src/api/config";

describe("resolveOrigin", () => {
  it("uses the browser location origin when present", () => {
    expect(resolveOrigin({}, { origin: "https://animichi.app" })).toBe("https://animichi.app");
  });

  it("falls back to VITE_SITE_ORIGIN on the server", () => {
    expect(resolveOrigin({ VITE_SITE_ORIGIN: "https://ssr.animichi.app" })).toBe(
      "https://ssr.animichi.app",
    );
  });

  it("throws on the server without a configured origin", () => {
    expect(() => resolveOrigin({})).toThrow(/VITE_SITE_ORIGIN/);
  });
});

describe("resolveApiConfig", () => {
  it("defaults both services to the resolved origin", () => {
    const config = resolveApiConfig({}, { origin: "https://animichi.app" });
    expect(config).toEqual({
      catalogUrl: "https://animichi.app",
      usersUrl: "https://animichi.app",
    });
  });

  it("keeps catalog and users base URLs separate when overridden", () => {
    const config = resolveApiConfig(
      { VITE_CATALOG_URL: "https://catalog.test", VITE_USERS_URL: "https://users.test" },
      { origin: "https://animichi.app" },
    );
    expect(config.catalogUrl).toBe("https://catalog.test");
    expect(config.usersUrl).toBe("https://users.test");
  });
});
