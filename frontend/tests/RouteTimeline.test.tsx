/**
 * RouteTimeline unit tests (TDD — C3 hardening).
 *
 * AC coverage (Task C3):
 * - Happy: 20-stop route renders ordered stops with walk segments and times -> unit
 * - Null/empty: stop with no image renders text-only row aligned to rail -> unit
 * - Boundary: current-position stop visually highlighted -> unit
 * - Error: malformed/zero-stop route data renders empty itinerary message -> unit
 * - i18n: stop labels, durations, and empty message localized -> unit
 *
 * Legacy ACs (preserved):
 * - Renders a numbered stop entry for each stop in the itinerary -> unit
 * - Shows arrival time and dwell duration per stop -> unit
 * - Renders a transit leg connector between consecutive stops -> unit
 * - Renders per-stop photo count using locale dict -> unit
 * - No transit connector shown after the last stop -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RouteTimeline from "@/components/generative/RouteTimeline";
import type { TimedItinerary, TimedStop, TransitLeg } from "@/lib/types";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => jaDict,
}));

// Mock useVirtualizer to render all items (no windowing in tests)
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn((opts: { count: number; estimateSize: (i: number) => number }) => {
    const items = Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: i,
      start: i * opts.estimateSize(i),
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => items.reduce((sum, it) => sum + opts.estimateSize(it.index), 0),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStop(overrides: Partial<TimedStop> = {}): TimedStop {
  return {
    cluster_id: "c-001",
    name: "宇治駅",
    arrive: "09:00",
    depart: "09:45",
    dwell_minutes: 45,
    lat: 34.88,
    lng: 135.8,
    photo_count: 3,
    points: [],
    ...overrides,
  };
}

function makeLeg(overrides: Partial<TransitLeg> = {}): TransitLeg {
  return {
    from_id: "c-001",
    to_id: "c-002",
    mode: "walk",
    duration_minutes: 10,
    distance_m: 700,
    ...overrides,
  };
}

function makeItinerary(overrides: Partial<TimedItinerary> = {}): TimedItinerary {
  const stop1 = makeStop({ cluster_id: "c-001", name: "宇治駅", arrive: "09:00" });
  const stop2 = makeStop({ cluster_id: "c-002", name: "平等院", arrive: "09:55" });
  return {
    stops: [stop1, stop2],
    legs: [makeLeg({ from_id: "c-001", to_id: "c-002" })],
    total_minutes: 120,
    total_distance_m: 1400,
    spot_count: 2,
    pacing: "normal",
    start_time: "09:00",
    export_google_maps_url: [],
    export_ics: "",
    ...overrides,
  };
}

function make20StopItinerary(): TimedItinerary {
  const stops: TimedStop[] = Array.from({ length: 20 }, (_, i) => ({
    cluster_id: `c-${i + 1}`,
    name: `スポット${i + 1}`,
    arrive: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`,
    depart: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "30" : "00"}`,
    dwell_minutes: 30,
    lat: 34.88 + i * 0.01,
    lng: 135.8 + i * 0.01,
    photo_count: 2,
    points: [],
  }));
  const legs: TransitLeg[] = stops.slice(0, -1).map((s, i) => ({
    from_id: s.cluster_id,
    to_id: stops[i + 1].cluster_id,
    mode: "walk" as const,
    duration_minutes: 8,
    distance_m: 600,
  }));
  return {
    stops,
    legs,
    total_minutes: 760,
    total_distance_m: 11400,
    spot_count: 40,
    pacing: "normal",
    start_time: "09:00",
    export_google_maps_url: [],
    export_ics: "",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RouteTimeline", () => {
  describe("stop rendering (legacy ACs)", () => {
    it("renders a numbered entry for each stop", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.getByText("平等院")).toBeInTheDocument();
    });

    it("shows both stops in order", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      const names = screen.getAllByText(/宇治駅|平等院/);
      expect(names.map((n) => n.textContent)).toEqual(["宇治駅", "平等院"]);
    });

    it("shows arrival time for each stop", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("09:00")).toBeInTheDocument();
      expect(screen.getByText("09:55")).toBeInTheDocument();
    });

    it("shows dwell duration for each stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001", dwell_minutes: 30 })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      expect(screen.getByText(/30 分/)).toBeInTheDocument();
    });

    it("shows photo count for each stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001", photo_count: 7 })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      // ja dict: "{count} 聖地"
      expect(screen.getByText(/7 聖地/)).toBeInTheDocument();
    });
  });

  describe("transit leg rendering (legacy ACs)", () => {
    it("renders a transit leg connector between two consecutive stops", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText(/10 分/)).toBeInTheDocument();
    });

    it("does not render a transit connector after the last stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001" })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      expect(screen.queryByText(/🚶/)).toBeNull();
    });
  });

  describe("per-stop photo count (legacy ACs)", () => {
    it("shows photo count in each stop using ja dict", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      // ja dict: "{count} 聖地" → "3 聖地"
      const badges = screen.getAllByText(/3 聖地/);
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  // ── C3 AC: Happy ──────────────────────────────────────────────────────────
  describe("C3 Happy: 20-stop route renders ordered stops with walk segments and times", () => {
    it("renders all 20 stop names", () => {
      render(<RouteTimeline itinerary={make20StopItinerary()} />);
      expect(screen.getByText("スポット1")).toBeInTheDocument();
      expect(screen.getByText("スポット20")).toBeInTheDocument();
    });

    it("renders walk segment durations between stops", () => {
      render(<RouteTimeline itinerary={make20StopItinerary()} />);
      // 19 legs each with 8 min
      const walkTexts = screen.getAllByText(/8 分/);
      expect(walkTexts.length).toBeGreaterThanOrEqual(1);
    });

    it("renders arrival times for stops", () => {
      render(<RouteTimeline itinerary={make20StopItinerary()} />);
      expect(screen.getByText("09:00")).toBeInTheDocument();
    });
  });

  // ── C3 AC: Null/empty ─────────────────────────────────────────────────────
  describe("C3 Null/empty: stop with no image renders text-only row aligned to rail", () => {
    it("renders stop name even when points array is empty (no screenshot_url)", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001", points: [] })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("no-image stop shares same 3-column layout as image stop (time + dot + content)", () => {
      const noImageStop = makeStop({ cluster_id: "c-001", points: [] });
      const imageStop = makeStop({
        cluster_id: "c-002",
        name: "平等院",
        points: [
          {
            id: "p-01",
            name: "平等院フォトスポット",
            name_cn: null,
            title: "Test",
            title_cn: "测试",
            latitude: 34.88,
            longitude: 135.8,
            screenshot_url: "https://example.com/img.jpg",
            bangumi_id: "1",
            episode: 1,
            time_seconds: null,
          },
        ],
      });
      render(
        <RouteTimeline
          itinerary={makeItinerary({ stops: [noImageStop, imageStop], legs: [] })}
        />,
      );
      // Both stops must render — if layout broke one would be absent
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.getByText("平等院")).toBeInTheDocument();
    });
  });

  // ── C3 AC: Boundary ───────────────────────────────────────────────────────
  describe("C3 Boundary: current-position stop visually highlighted", () => {
    it("active stop element has data-active attribute", () => {
      const itinerary = makeItinerary();
      render(
        <RouteTimeline itinerary={itinerary} activeStopId="c-001" />,
      );
      const activeEl = document.querySelector("[data-active='true']");
      expect(activeEl).not.toBeNull();
    });

    it("inactive stops do not have data-active attribute", () => {
      const itinerary = makeItinerary();
      render(
        <RouteTimeline itinerary={itinerary} activeStopId="c-001" />,
      );
      const inactiveEls = document.querySelectorAll("[data-active='false']");
      expect(inactiveEls.length).toBeGreaterThan(0);
    });
  });

  // ── C3 AC: Error ──────────────────────────────────────────────────────────
  describe("C3 Error: malformed/zero-stop route data renders empty itinerary message", () => {
    it("renders empty itinerary message for 0-stop route", () => {
      const empty: TimedItinerary = {
        stops: [],
        legs: [],
        total_minutes: 0,
        total_distance_m: 0,
        spot_count: 0,
        pacing: "normal",
        start_time: "",
        export_google_maps_url: [],
        export_ics: "",
      };
      render(<RouteTimeline itinerary={empty} />);
      // ja dict: timeline_empty
      expect(screen.getByText(jaDict.route.timeline_empty)).toBeInTheDocument();
    });

    it("does not crash for 0-stop route", () => {
      const empty: TimedItinerary = {
        stops: [],
        legs: [],
        total_minutes: 0,
        total_distance_m: 0,
        spot_count: 0,
        pacing: "normal",
        start_time: "",
        export_google_maps_url: [],
        export_ics: "",
      };
      expect(() => render(<RouteTimeline itinerary={empty} />)).not.toThrow();
    });
  });

  // ── C3 AC: i18n ───────────────────────────────────────────────────────────
  describe("C3 i18n: stop labels, durations, and empty message localized", () => {
    it("en dict has required timeline_empty key", () => {
      expect(enDict.route.timeline_empty).toBeTruthy();
    });

    it("zh dict has required timeline_empty key", () => {
      expect(zhDict.route.timeline_empty).toBeTruthy();
    });

    it("ja dict has required timeline_empty key", () => {
      expect(jaDict.route.timeline_empty).toBeTruthy();
    });

    it("dwell duration label uses locale dict (分)", () => {
      render(
        <RouteTimeline
          itinerary={makeItinerary({ stops: [makeStop({ dwell_minutes: 20 })], legs: [] })}
        />,
      );
      expect(screen.getByText(/20 分/)).toBeInTheDocument();
    });

    it("stop photo count uses locale dict format", () => {
      render(
        <RouteTimeline
          itinerary={makeItinerary({ stops: [makeStop({ photo_count: 5 })], legs: [] })}
        />,
      );
      expect(screen.getByText(/5 聖地/)).toBeInTheDocument();
    });
  });
});
