/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimedItinerary } from "../../../src/features/chat/components/TimedItinerary";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { itineraryView } from "../../../src/features/chat/lib/itinerary";
import { ujiItinerary } from "./_route-fixtures";

afterEach(cleanup);

const ja = chatDictFor("ja");

function renderTimeline(locale: "ja" | "zh" | "en" = "ja") {
  const dict = chatDictFor(locale);
  return { dict, ...render(<TimedItinerary view={itineraryView(ujiItinerary())} dict={dict} />) };
}

describe("AC1: station-granularity HH:MM timeline", () => {
  it("renders each station with its labelled HH:MM arrive–depart window", () => {
    renderTimeline();
    const timeline = screen.getByRole("list", { name: ja.route.timelineLabel });
    expect(timeline.querySelectorAll(".chat-itinerary__stop")).toHaveLength(3);
    expect(screen.getByText("10:00–10:20")).toBeTruthy();
    expect(screen.getByText("10:32–10:52")).toBeTruthy();
  });

  it("gold-stars exactly one station — the most-photographed — with an AT name", () => {
    renderTimeline();
    const star = screen.getByRole("img", { name: ja.route.highlight });
    expect(star.closest(".chat-itinerary__stop--highlight")?.textContent).toContain("京阪宇治駅");
    expect(document.querySelectorAll(".chat-itinerary__star")).toHaveLength(1);
  });

  it("keeps walking and transit durations readable in the route order", () => {
    renderTimeline();
    expect(screen.getByText("徒歩12分").getAttribute("data-mode")).toBe("walk");
    expect(screen.getByText("移動8分").getAttribute("data-mode")).toBe("transit");
    expect(screen.getByRole("list", { name: ja.route.timelineLabel }).children).toHaveLength(3);
  });
});

describe("AC6: pacing pill and CTA row copy per locale", () => {
  it("renders the ja pacing pill and CTA copy", () => {
    renderTimeline("ja");
    expect(screen.getByText("ゆったり").getAttribute("data-pacing")).toBe("chill");
    expect(screen.getByRole("link", { name: ja.route.openMaps }).getAttribute("href")).toBe("https://maps.example/route");
    expect(screen.getByRole("button", { name: ja.route.saveCta })).toBeTruthy();
  });

  it("renders the zh pacing pill and CTA copy", () => {
    const { dict } = renderTimeline("zh");
    expect(screen.getByText("悠闲")).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.route.saveCta })).toBeTruthy();
    expect(screen.getByRole("link", { name: dict.route.openMaps })).toBeTruthy();
  });

  it("renders the en pacing pill and CTA copy", () => {
    const { dict } = renderTimeline("en");
    expect(screen.getByText("Chill")).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.route.saveCta })).toBeTruthy();
  });
});

describe("route actions", () => {
  it("omits the unavailable Walk-mode entry", () => {
    renderTimeline();
    expect(screen.queryByRole("button", { name: ja.route.walkCta })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("sparse itineraries", () => {
  it("omits pill, times, and maps link when the payload has none", () => {
    const bare = { ...ujiItinerary(), pacing: undefined, export_google_maps_url: [], stops: ujiItinerary().stops.map((stop) => ({ ...stop, arrive: "", depart: "" })) };
    render(<TimedItinerary view={itineraryView(bare)} dict={ja} />);
    expect(document.querySelector(".chat-pacing-pill")).toBeNull();
    expect(document.querySelector(".chat-itinerary__time")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
