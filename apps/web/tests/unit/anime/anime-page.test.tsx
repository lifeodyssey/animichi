/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnimePage } from "../../../src/features/anime/AnimePage";
import { emptyOverviewFixture, fullOverviewFixture } from "../../msw/anime-overview";

afterEach(cleanup);

function headingText(): string | null {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("AnimePage full state", () => {
  it("renders the localized ja heading with pilgrimage keywords", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    expect(headingText()).toContain("聖地巡礼");
  });

  it("renders the fact-summary block as a definition-list section", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    const facts = screen.getByRole("region", { name: "作品ファクト" });
    expect(facts.querySelector("dl")).not.toBeNull();
  });

  it("states the total spot count as a self-contained sentence", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    expect(screen.getByText("この作品の聖地スポットは全6件が登録されています。")).toBeTruthy();
  });

  it("cites the top-3 cities and the Anitabi attribution", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    expect(screen.getByText(/Takayama、Tokyo、Hida/)).toBeTruthy();
    expect(screen.getByText(/Anitabi/)).toBeTruthy();
    expect(screen.getByText(/CC BY-NC-SA/)).toBeTruthy();
  });

  it("lists 名場面 sorted by shot count with accessible images", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    const names = screen.getAllByRole("listitem").map((item) => item.textContent);
    const suga = names.findIndex((text) => text.includes("Suga Shrine Stairs"));
    const hida = names.findIndex((text) => text.includes("Hida Furukawa Station"));
    expect(suga).toBeGreaterThanOrEqual(0);
    expect(suga).toBeLessThan(hida);
    expect(screen.getByRole("img", { name: "Suga Shrine Stairs" })).toBeTruthy();
  });

  it("renders a region skeleton entry per circle", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    const areas = screen.getByRole("region", { name: "エリア別スポット" });
    for (const region of ["Takayama", "Tokyo", "Hida"]) {
      expect(areas.textContent).toContain(region);
    }
  });
});

describe("AnimePage partial data", () => {
  it("omits the duration fact when there are no sample routes", () => {
    render(<AnimePage overview={{ ...fullOverviewFixture, sample_routes: [] }} locale="ja" />);
    expect(screen.queryByText(/所要時間は約/)).toBeNull();
  });

  it("renders a scene without a city, with no dangling separator", () => {
    const scenes = fullOverviewFixture.scenes.map(({ city: _city, ...scene }) => scene);
    render(<AnimePage overview={{ ...fullOverviewFixture, scenes }} locale="ja" />);
    expect(screen.getByText("カット数 2")).toBeTruthy();
  });
});

describe("AnimePage locales", () => {
  it("renders the zh heading with zh-native keywords", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="zh" />);
    expect(headingText()).toContain("圣地巡礼");
  });

  it("renders the en heading with en-native keywords", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="en" />);
    expect(headingText()).toContain("Pilgrimage");
  });
});

describe("AnimePage empty state", () => {
  it("renders the graceful ja empty message when the work has no spots", () => {
    render(<AnimePage overview={emptyOverviewFixture("404404")} locale="ja" />);
    expect(screen.getByText("この作品はまだ聖地情報がありません")).toBeTruthy();
  });

  it("keeps the localized heading in the empty state", () => {
    render(<AnimePage overview={emptyOverviewFixture("404404")} locale="en" />);
    expect(headingText()).toContain("Pilgrimage");
  });
});

function jsonLdNodes(container: HTMLElement): Record<string, unknown>[] {
  const el = container.querySelector('script[type="application/ld+json"]');
  return el === null ? [] : (JSON.parse(el.innerHTML) as Record<string, unknown>[]);
}

describe("AnimePage JSON-LD", () => {
  it("injects a CreativeWork + BreadcrumbList graph into the page body", () => {
    const { container } = render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    const types = jsonLdNodes(container).map((node) => node["@type"]);
    expect(types).toContain("CreativeWork");
    expect(types).toContain("BreadcrumbList");
  });

  it("varies non-template field values with the work's actual data", () => {
    const { container } = render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
    const work = jsonLdNodes(container).find((node) => node["@type"] === "CreativeWork");
    const props = work?.additionalProperty as Record<string, unknown>[];
    expect(props.find((p) => p.name === "pilgrimageSpotCount")?.value).toBe(6);
  });

  it("still emits valid JSON-LD for a zero-spot work", () => {
    const { container } = render(<AnimePage overview={emptyOverviewFixture("404404")} locale="ja" />);
    expect(jsonLdNodes(container).some((node) => node["@type"] === "CreativeWork")).toBe(true);
  });
});
