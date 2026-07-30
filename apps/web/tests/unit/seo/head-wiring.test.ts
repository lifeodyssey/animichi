import { describe, expect, it } from "vitest";
import { SITE_ICON_LINKS, SITE_META, homeHead } from "../../../src/features/seo/head";
import { SITE_DESCRIPTION, SITE_TITLE } from "../../../src/features/seo/site";
import { Route as HomeRoute } from "../../../src/routes/index";
import { rootHead } from "../../../src/routes/__root";

/** A head fragment is only SEO if a route actually emits it. */
describe("root route head", () => {
  it("titles and describes the document with the budgeted site copy", () => {
    expect(rootHead.meta).toContainEqual({ title: SITE_TITLE });
    expect(rootHead.meta).toContainEqual({ name: "description", content: SITE_DESCRIPTION });
  });

  it("emits every og and twitter tag", () => {
    for (const tag of SITE_META) {
      expect(rootHead.meta).toContainEqual(tag);
    }
  });

  it("emits the brand icons without dropping the stylesheet", () => {
    for (const link of SITE_ICON_LINKS) {
      expect(rootHead.links).toContainEqual(link);
    }
    expect(rootHead.links.some((link) => link.rel === "stylesheet")).toBe(true);
  });
});

describe("home route head", () => {
  it("is wired to the home head builder", () => {
    expect(HomeRoute.options.head).toBe(homeHead);
  });

  it("keeps JSON-LD on the router head channel, never dangerouslySetInnerHTML", () => {
    expect(homeHead().scripts[0]?.type).toBe("application/ld+json");
  });
});
