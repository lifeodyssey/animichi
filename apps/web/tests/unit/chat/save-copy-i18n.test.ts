import { describe, expect, it } from "vitest";
import { SaveRouteInput } from "@animichi/contract";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { saveRouteTitle } from "../../../src/features/chat/route-copy";
import { routeSaveTarget } from "../../../src/features/chat/save/saveTarget";
import { parsedPart, routePartRaw, ujiPoints } from "./_route-fixtures";

const LOCALES = ["ja", "zh", "en"] as const;

function titleIn(locale: (typeof LOCALES)[number]): string {
  return saveRouteTitle(chatDictFor(locale), "響け!ユーフォニアム", 3);
}

describe("AC11: the save title is derived, bounded and localized", () => {
  it("names the resolved work and its stop count", () => {
    expect(titleIn("ja")).toContain("響け!ユーフォニアム");
    expect(titleIn("ja")).toContain("3");
  });

  it("renders a different title in each locale — none is an untranslated fallback", () => {
    const rendered = LOCALES.map(titleIn);
    expect(new Set(rendered).size).toBe(LOCALES.length);
  });

  it("substitutes every template slot in every locale", () => {
    for (const rendered of LOCALES.map(titleIn)) {
      expect(rendered).not.toContain("{title}");
      expect(rendered).not.toContain("{count}");
    }
  });

  it("falls back to a localized work name rather than an empty or English one", () => {
    const missing = LOCALES.map((locale) => saveRouteTitle(chatDictFor(locale), undefined, 2));
    expect(new Set(missing).size).toBe(LOCALES.length);
    for (const rendered of missing) expect(rendered.length).toBeGreaterThan(0);
  });

  it("stays inside SaveRouteInput's 1-200 bound even for a very long work title", () => {
    const title = saveRouteTitle(chatDictFor("ja"), "あ".repeat(400), 3);
    expect(SaveRouteInput.safeParse({ title, point_ids: ["p1"] }).success).toBe(true);
    expect(title.length).toBeLessThanOrEqual(200);
    // A naive slice of the RENDERED string would amputate the tail; the trim
    // must land on the work title so the stop count survives.
    expect(title).toContain("3スポットの聖地巡礼");
  });
});

describe("P3: the derived title is injection- and grapheme-safe", () => {
  it("keeps a work title containing replacement patterns verbatim", () => {
    const title = saveRouteTitle(chatDictFor("ja"), "$& $1 $` Euphonium", 3);
    expect(title).toContain("$& $1 $` Euphonium");
  });

  it("never splits a surrogate pair when truncating a long emoji title", () => {
    const title = saveRouteTitle(chatDictFor("ja"), "🎺".repeat(300), 3);
    expect(title.length).toBeLessThanOrEqual(200);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(title)).toBe(false);
  });

  it("still produces a contract-valid title after truncation", () => {
    const title = saveRouteTitle(chatDictFor("en"), "👨‍👩‍👧‍👦".repeat(60), 5);
    expect(SaveRouteInput.safeParse({ title, point_ids: ["p1"] }).success).toBe(true);
  });
});

describe("AC12: save CTA, confirmation and error copy exist in ja / zh / en", () => {
  it.each(LOCALES)("renders distinct %s save copy", (locale) => {
    const route = chatDictFor(locale).route;
    for (const copy of [route.saveCta, route.saved, route.saveError, route.saveRetry]) {
      expect(copy.length).toBeGreaterThan(0);
    }
  });

  it("keeps the CTA, confirmation and error strings distinct per locale", () => {
    expect(new Set(LOCALES.map((locale) => chatDictFor(locale).route.saveCta)).size).toBe(3);
    expect(new Set(LOCALES.map((locale) => chatDictFor(locale).route.saved)).size).toBe(3);
    expect(new Set(LOCALES.map((locale) => chatDictFor(locale).route.saveError)).size).toBe(3);
  });
});

describe("the save target is derived from the rendered route", () => {
  it("carries the route's point ids in walking order plus a derived title", () => {
    const part = parsedPart(routePartRaw([...ujiPoints()], { anime_title: "響け!ユーフォニアム" }));
    const target = routeSaveTarget(part, chatDictFor("ja"));
    expect(target?.pointIds).toEqual(["a", "b", "c"]);
    expect(target?.title).toContain("響け!ユーフォニアム");
  });

  it("is undefined for a route with no placeable points, so the CTA stays disabled", () => {
    const part = parsedPart(routePartRaw([]));
    expect(routeSaveTarget(part, chatDictFor("ja"))).toBeUndefined();
  });

  it("accepts bare id strings and drops blank ids from the stream", () => {
    const raw = { intent: "plan_route", success: true, status: "ok", data: { route: { ordered_points: ["x", "", "y"], point_count: 3 } } };
    expect(routeSaveTarget(parsedPart(raw), chatDictFor("ja"))?.pointIds).toEqual(["x", "y"]);
  });

  it("is undefined for a non-route card", () => {
    const part = parsedPart({ intent: "general_qa", success: true, status: "ok", data: {} });
    expect(routeSaveTarget(part, chatDictFor("ja"))).toBeUndefined();
  });
});
