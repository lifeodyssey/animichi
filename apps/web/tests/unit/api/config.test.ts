import { describe, expect, it } from "vitest";
import { resolveApiConfig, resolveOrigin } from "../../../src/api/config";

describe("resolveOrigin", () => {
  it("uses the browser location origin when present", () => {
    expect(resolveOrigin({}, { origin: "https://animichi.app" })).toBe("https://animichi.app");
  });

  it("prefers the api.siteOrigin override on the server", () => {
    const api = { siteOrigin: "https://ssr.animichi.app" };
    expect(resolveOrigin(api, undefined, () => "https://request.test")).toBe(
      "https://ssr.animichi.app",
    );
  });

  it("reads the SSR request-context origin when no override is set", () => {
    expect(resolveOrigin({}, undefined, () => "https://request.test")).toBe(
      "https://request.test",
    );
  });

  it("fails loud instead of degrading when the server has no origin source", () => {
    expect(() => resolveOrigin({}, undefined, () => undefined)).toThrow(/api\.siteOrigin/);
  });

  it("fails loud with the default request-context source outside a request", () => {
    expect(() => resolveOrigin({})).toThrow(/api\.siteOrigin/);
  });
});

describe("resolveApiConfig", () => {
  it("defaults both services to the resolved origin (same-origin fan-out)", () => {
    const config = resolveApiConfig({}, { origin: "https://animichi.app" });
    expect(config).toEqual({
      catalogUrl: "https://animichi.app",
      usersUrl: "https://animichi.app",
    });
  });

  it("keeps catalog and users base URLs separate when overridden", () => {
    const config = resolveApiConfig(
      { catalogUrl: "https://catalog.test", usersUrl: "https://users.test" },
      { origin: "https://animichi.app" },
    );
    expect(config.catalogUrl).toBe("https://catalog.test");
    expect(config.usersUrl).toBe("https://users.test");
  });

  it("never resolves the origin when both service URLs are configured", () => {
    const api = { catalogUrl: "https://catalog.test", usersUrl: "https://users.test" };
    expect(() => resolveApiConfig(api)).not.toThrow();
    expect(resolveApiConfig(api)).toEqual({
      catalogUrl: "https://catalog.test",
      usersUrl: "https://users.test",
    });
  });
});
