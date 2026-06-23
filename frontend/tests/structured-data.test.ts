import { describe, it, expect } from "vitest";
import { websiteJsonLd, organizationJsonLd, faqJsonLd } from "../lib/structured-data";

describe("structured-data JSON-LD exports", () => {
  it("websiteJsonLd has correct type and search action", () => {
    expect(websiteJsonLd["@type"]).toBe("WebSite");
    expect(websiteJsonLd.potentialAction["@type"]).toBe("SearchAction");
  });

  it("organizationJsonLd has correct type and logo", () => {
    expect(organizationJsonLd["@type"]).toBe("Organization");
    expect(organizationJsonLd.logo).toContain("og-image.png");
  });

  it("faqJsonLd has three questions", () => {
    expect(faqJsonLd["@type"]).toBe("FAQPage");
    expect(faqJsonLd.mainEntity).toHaveLength(3);
  });
});
