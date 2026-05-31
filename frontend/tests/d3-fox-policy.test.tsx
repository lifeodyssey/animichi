/**
 * D3 — Fox policy on emotional state surfaces
 *
 * AC coverage:
 * - Happy: WelcomeScreen shows FoxGuide pose="welcome" -> browser/render
 * - Happy: Clarification (AI-working state) shows FoxGuide pose="ai-navigator" -> render
 * - Happy: ResultPanelEmptyState shows FoxGuide pose="traveler" -> render
 * - Happy: LocationPrompt shows FoxGuide pose="welcome" + allow/skip/manual -> render
 * - Boundary: RouteConfirm (09) renders without FoxGuide (policy assertion) -> unit
 * - Boundary: RouteTimeline (10) renders without FoxGuide (policy assertion) -> unit
 * - Boundary: ResultPanelEmptyState in error=true mode renders without FoxGuide -> unit
 * - Error: LocationPrompt "skip" falls back to manual input without error -> integration
 * - i18n: agent_working/no_results/permission copy localized in ja/en/zh -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks shared across tests
// ---------------------------------------------------------------------------

function stubMatchMedia(reducedMotion = false) {
  window.matchMedia = (query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  stubMatchMedia(false);
});

// ---------------------------------------------------------------------------
// 1. Happy — WelcomeScreen shows FoxGuide pose="welcome"
// ---------------------------------------------------------------------------

import WelcomeScreen from "@/components/chat/WelcomeScreen";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;

describe("D3 Happy — WelcomeScreen fox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders a FoxGuide image with fox-a-city-guide (welcome pose)", () => {
    const { container } = render(
      <WelcomeScreen onSend={vi.fn()} dict={jaFull} locale="ja" />,
    );
    const foxImg = container.querySelector("img[src*='fox-a-city-guide']");
    expect(foxImg).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Happy — Clarification shows FoxGuide pose="ai-navigator"
// ---------------------------------------------------------------------------

import Clarification from "@/components/generative/Clarification";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => jaDict,
}));

describe("D3 Happy — Clarification fox", () => {
  it("renders fox-c-ai-navigator when candidates are provided (disambiguation state 04)", () => {
    const { container } = render(
      <Clarification
        message="どの作品ですか？"
        candidates={[{ title: "涼宮ハルヒの憂鬱", cover_url: null, spot_count: 0, city: "" }]}
        onSuggest={vi.fn()}
      />,
    );
    const foxImg = container.querySelector("img[src*='fox-c-ai-navigator']");
    expect(foxImg).toBeInTheDocument();
  });

  it("renders fox-d-backpack-traveler in the fallback state (no candidates/options)", () => {
    const { container } = render(
      <Clarification
        message="どの作品ですか？"
        onSuggest={vi.fn()}
      />,
    );
    const foxImg = container.querySelector("img[src*='fox-d-backpack-traveler']");
    expect(foxImg).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Happy — ResultPanelEmptyState shows FoxGuide pose="traveler"
// ---------------------------------------------------------------------------

import { ResultPanelEmptyState } from "@/components/layout/ResultPanelEmptyState";

describe("D3 Happy — ResultPanelEmptyState fox (traveler)", () => {
  it("renders a FoxGuide image with fox-d-backpack-traveler", () => {
    const { container } = render(<ResultPanelEmptyState />);
    const foxImg = container.querySelector("img[src*='fox-d-backpack-traveler']");
    expect(foxImg).toBeInTheDocument();
  });

  it("does NOT render FoxGuide when isError=true (error mode delegates to ErrorRetryTicket)", () => {
    const { container } = render(
      <ResultPanelEmptyState isError onRetry={vi.fn()} />,
    );
    const foxImg = container.querySelector("img[src*='fox-']");
    expect(foxImg).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Happy — LocationPrompt shows FoxGuide + allow/skip/manual
// ---------------------------------------------------------------------------

import LocationPrompt from "@/components/chat/LocationPrompt";

function renderLocationPrompt(overrides: Partial<React.ComponentProps<typeof LocationPrompt>> = {}) {
  return render(
    <LocationPrompt
      onCoords={vi.fn()}
      onStation={vi.fn()}
      onDismiss={vi.fn()}
      dict={jaFull}
      locale="ja"
      {...overrides}
    />,
  );
}

describe("D3 Happy — LocationPrompt fox (permission surface)", () => {
  it("renders a FoxGuide image with fox-a-city-guide (welcome pose on permission surface)", () => {
    const { container } = renderLocationPrompt();
    const foxImg = container.querySelector("img[src*='fox-a-city-guide']");
    expect(foxImg).toBeInTheDocument();
  });

  it("renders allow, skip, and manual entry options", () => {
    renderLocationPrompt();
    // Allow button uses fox_guide.permission_allow
    expect(screen.getByText("現在地を使う")).toBeInTheDocument();
    // Manual entry uses fox_guide.permission_manual
    expect(screen.getByText("場所を入力する")).toBeInTheDocument();
    // Skip button uses fox_guide.permission_skip
    const skipBtn = screen.getByRole("button", { name: /スキップ/i });
    expect(skipBtn).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Error — "skip" falls back to manual station input without error
// ---------------------------------------------------------------------------

describe("D3 Error — LocationPrompt skip falls back to manual input", () => {
  it("shows station text input after skip without throwing", async () => {
    const { container } = renderLocationPrompt();
    const skipBtn = screen.getByRole("button", { name: /スキップ/i });
    await userEvent.click(skipBtn);
    // Manual input should appear
    const input = container.querySelector("input[type='text']");
    expect(input).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. Boundary — High-task surfaces (05, 09, 10) have NO FoxGuide
// ---------------------------------------------------------------------------

import RouteConfirm from "@/components/generative/RouteConfirm";
import RouteTimeline from "@/components/generative/RouteTimeline";
import type { PilgrimagePoint, TimedItinerary } from "@/lib/types";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));
vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

function makePoint(id: string): PilgrimagePoint {
  return {
    id,
    name: `スポット-${id}`,
    name_cn: null,
    episode: null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: "bg-001",
    latitude: 35.0,
    longitude: 135.0,
  };
}

describe("D3 Boundary — RouteConfirm (state 09) has no FoxGuide", () => {
  it("renders RouteConfirm without any fox-guide image", () => {
    const points = [makePoint("p1"), makePoint("p2")];
    const { container } = render(
      <RouteConfirm
        points={points}
        defaultOrigin="宇治駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const foxImgs = container.querySelectorAll("img[src*='fox-']");
    expect(foxImgs).toHaveLength(0);
  });
});

describe("D3 Boundary — RouteTimeline (state 10) has no FoxGuide", () => {
  const itinerary: TimedItinerary = {
    stops: [
      {
        cluster_id: "c1",
        name: "スポット1",
        arrive: "10:00",
        depart: "10:30",
        dwell_minutes: 30,
        lat: 35.0,
        lng: 135.0,
        photo_count: 1,
        points: [makePoint("p1")],
      },
      {
        cluster_id: "c2",
        name: "スポット2",
        arrive: "11:00",
        depart: "11:30",
        dwell_minutes: 30,
        lat: 35.1,
        lng: 135.1,
        photo_count: 0,
        points: [makePoint("p2")],
      },
    ],
    legs: [],
    total_minutes: 90,
    total_distance_m: 1200,
    spot_count: 2,
    pacing: "normal",
    start_time: "10:00",
    export_google_maps_url: [],
    export_ics: "",
  };

  it("renders RouteTimeline without any fox-guide image", () => {
    const { container } = render(
      <RouteTimeline itinerary={itinerary} />,
    );
    const foxImgs = container.querySelectorAll("img[src*='fox-']");
    expect(foxImgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. i18n — fox_guide copy localized in ja/en/zh
// ---------------------------------------------------------------------------

describe("D3 i18n — fox_guide dictionary keys present in all locales", () => {
  it("ja dict has fox_guide.agent_working", () => {
    expect(jaFull.fox_guide?.agent_working).toBeTruthy();
  });

  it("ja dict has fox_guide.no_results", () => {
    expect(jaFull.fox_guide?.no_results).toBeTruthy();
  });

  it("ja dict has fox_guide.permission_title", () => {
    expect(jaFull.fox_guide?.permission_title).toBeTruthy();
  });

  it("ja dict has fox_guide.permission_skip", () => {
    expect(jaFull.fox_guide?.permission_skip).toBeTruthy();
  });

  it("en dict has fox_guide.agent_working", () => {
    expect(enFull.fox_guide?.agent_working).toBeTruthy();
  });

  it("en dict has fox_guide.no_results", () => {
    expect(enFull.fox_guide?.no_results).toBeTruthy();
  });

  it("zh dict has fox_guide.agent_working", () => {
    expect(zhFull.fox_guide?.agent_working).toBeTruthy();
  });

  it("zh dict has fox_guide.no_results", () => {
    expect(zhFull.fox_guide?.no_results).toBeTruthy();
  });
});
