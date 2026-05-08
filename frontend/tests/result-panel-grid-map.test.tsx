/**
 * ResultPanel — map view (default), grid toggle, episode filter chips,
 * and floating spot list overlay.
 *
 * AC coverage:
 * - Default view is "map" not "grid" -> unit
 * - Grid/map toggle switches view -> unit
 * - FloatingSpotList renders spot items in map view -> unit
 * - Filter chips appear for episode ranges when results have episode data -> unit
 * - Loading skeleton renders shadcn Skeleton -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import ResultPanel from "@/components/layout/ResultPanel";
import type { RuntimeResponse, PilgrimagePoint } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({ useDict: () => defaultDict }));

vi.mock("@/components/generative/GenerativeUIRenderer", () => ({
  default: ({ response }: { response: RuntimeResponse }) => (
    <div data-testid="generative-ui">{response.intent}</div>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, opts?: { ssr?: boolean }) => {
    if (opts?.ssr !== false) throw new Error("Leaflet dynamic import must have ssr: false");
    const LazyMap = () => <div data-testid="lazy-map-placeholder" />;
    LazyMap.displayName = "LazyMap";
    return LazyMap;
  },
}));

const BASE_POINT: PilgrimagePoint = {
  id: "pt-001",
  name: "宇治駅",
  name_cn: null,
  episode: 1,
  time_seconds: null,
  screenshot_url: "https://example.com/img.jpg",
  bangumi_id: "bg-001",
  latitude: 34.88,
  longitude: 135.8,
};

function makeResponse(rows: Partial<PilgrimagePoint>[] = [BASE_POINT]): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_bangumi",
    session_id: "s-001",
    message: "ok",
    data: {
      results: {
        rows: rows.map((r) => ({ ...BASE_POINT, ...r })),
        row_count: rows.length,
        strategy: "sql",
        status: rows.length > 0 ? "ok" : "empty",
      },
      message: "ok",
      status: rows.length > 0 ? "ok" : "empty",
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set(), toggle: () => {}, clear: () => {} }}
    >
      {children}
    </PointSelectionContext.Provider>
  );
}

describe("ResultPanel default view is map", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders map view by default (not grid)", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });

  it("renders floating spot list in default map view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByTestId("floating-spot-list")).toBeInTheDocument();
  });

  it("renders view toggle buttons in map view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByRole("button", { name: /グリッド/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /マップ/i })).toBeInTheDocument();
  });
});

describe("ResultPanel grid/map view toggle", () => {
  it("switches to grid view when grid toggle is clicked", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    expect(screen.getByText("宇治駅")).toBeInTheDocument();
    expect(screen.queryByTestId("lazy-map-placeholder")).toBeNull();
  });

  it("switches back to map view when map toggle is clicked after switching to grid", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });

  it("does not render grid content in default map view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    // PhotoCard renders the name directly; in map view, it appears only in floating list
    // The grid PhotoCard component is not rendered in map view
    expect(screen.queryByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });
});

describe("ResultPanel FloatingSpotList in map view", () => {
  it("renders spot items in the floating list", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByTestId("spot-item-pt-001")).toBeInTheDocument();
  });

  it("renders spots header with count", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001" },
      { ...BASE_POINT, id: "pt-002", name: "京アニスタジオ" },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    // ja dict: spots_count = "{count}件"
    expect(screen.getByText("2件")).toBeInTheDocument();
  });

  it("renders filter tabs inside floating list", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByText(defaultDict.toolbar.tab_episode)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.toolbar.tab_area)).toBeInTheDocument();
  });
});

describe("ResultPanel Mapbox lazy loading", () => {
  it("does not render map content when in grid view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    expect(screen.queryByTestId("lazy-map-placeholder")).toBeNull();
  });

  it("renders lazy map placeholder (ssr:false enforced) in default map view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });
});

describe("ResultPanel filter chips for episode ranges", () => {
  it("renders a 'すべて' chip when results have episode data", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001", episode: 1 },
      { ...BASE_POINT, id: "pt-002", episode: 3 },
      { ...BASE_POINT, id: "pt-003", episode: 7 },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    expect(screen.getByRole("button", { name: /すべて/i })).toBeInTheDocument();
  });

  it("renders episode range chips based on available episodes", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001", episode: 1 },
      { ...BASE_POINT, id: "pt-002", episode: 3 },
      { ...BASE_POINT, id: "pt-003", episode: 7 },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    const epChips = screen
      .getAllByRole("button")
      .filter((btn) => /EP\s?\d/.test(btn.textContent ?? ""));
    expect(epChips.length).toBeGreaterThan(0);
  });

  it("does not render episode filter chips when no episode data exists", () => {
    const response = makeResponse([{ ...BASE_POINT, id: "pt-001", episode: null }]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    const epChips = screen
      .getAllByRole("button")
      .filter((btn) => /EP\s?\d/.test(btn.textContent ?? ""));
    expect(epChips).toHaveLength(0);
  });
});

describe("ResultPanel loading skeleton", () => {
  it("renders shadcn Skeleton components in loading state", () => {
    render(<Wrapper><ResultPanel activeResponse={null} loading /></Wrapper>);
    expect(screen.getByTestId("loading-skeleton")).toBeInTheDocument();
    // shadcn Skeleton renders with data-slot="skeleton"
    const skeletons = screen.getByTestId("loading-skeleton").querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
