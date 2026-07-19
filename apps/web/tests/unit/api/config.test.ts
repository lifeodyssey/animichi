import { describe, expect, it } from "vitest";
import { resolveApiConfig, resolveOrigin } from "../../../src/api/config";

describe("resolveOrigin", () => {
  it("uses the browser location origin when present", () => {
    expect(resolveOrigin({}, { origin: "https://animichi.app" })).toBe("https://animichi.app");
  });

  it("prefers the VITE_SITE_ORIGIN override on the server", () => {
    const env = { VITE_SITE_ORIGIN: "https://ssr.animichi.app" };
    expect(resolveOrigin(env, undefined, () => "https://request.test")).toBe(
      "https://ssr.animichi.app",
    );
  });

  it("reads the SSR request-context origin when no override is set", () => {
    expect(resolveOrigin({}, undefined, () => "https://request.test")).toBe(
      "https://request.test",
    );
  });

  it("degrades to a relative origin instead of throwing when every source is missing", () => {
    expect(resolveOrigin({}, undefined, () => undefined)).toBe("");
  });

  it("degrades gracefully with the default request-context source outside a request", () => {
    expect(resolveOrigin({})).toBe("");
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
