/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  CF_WEB_ANALYTICS_SRC,
  cfWebAnalyticsScripts,
} from "../../../src/features/seo/analytics";
import { rootHead } from "../../../src/routes/__root";

const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("cfWebAnalyticsScripts", () => {
  it("emits the beacon tag in a production build with a token", () => {
    const script = cfWebAnalyticsScripts(TOKEN, true).at(0);
    expect(script).toBeDefined();
    expect(script?.src).toBe(CF_WEB_ANALYTICS_SRC);
    expect(script?.defer).toBe(true);
    expect(JSON.parse(script?.["data-cf-beacon"] ?? "")).toEqual({ token: TOKEN });
  });

  it("emits nothing when the token is absent", () => {
    expect(cfWebAnalyticsScripts(undefined, true)).toEqual([]);
  });

  it("emits nothing for an empty token", () => {
    expect(cfWebAnalyticsScripts("", true)).toEqual([]);
  });

  it("emits nothing outside a production build (dev/test mode)", () => {
    expect(cfWebAnalyticsScripts(TOKEN, false)).toEqual([]);
  });
});

describe("root head beacon wiring", () => {
  it("keeps the theme bootstrap script ahead of any analytics tag", () => {
    const first = (rootHead().scripts as readonly object[])[0];
    expect(JSON.stringify(first)).toContain("animichi-theme");
  });

  it("never renders the beacon under the unit-test build", () => {
    expect(JSON.stringify(rootHead().scripts)).not.toContain("cloudflareinsights");
  });
});
