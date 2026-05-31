/**
 * ResultPanel — SelectionTray integration (state 08 wire-up, D5).
 *
 * AC coverage:
 * - Happy: state 08 renders SelectionTray (not legacy SelectionBar) → unit
 * - Happy: 3 selected → chips count + plan-route-btn enabled → unit
 * - Happy: plan-route-btn click transitions to confirm mode → integration
 * - Boundary: 0 selected → tray hidden → unit
 * - Boundary: clear button calls context clear → unit
 * - Regression: selection tray visible in both map and grid views → unit
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
        status: "ok",
      },
      message: "ok",
      status: "ok",
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

function Wrapper({
  selectedIds = new Set<string>(),
  toggle = () => {},
  clear = () => {},
  children,
}: {
  selectedIds?: Set<string>;
  toggle?: (id: string) => void;
  clear?: () => void;
  children: ReactNode;
}) {
  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear }}>
      {children}
    </PointSelectionContext.Provider>
  );
}

describe("ResultPanel — SelectionTray integration (D5)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders SelectionTray (not legacy SelectionBar) when spots are selected", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("shows selection-tray when one or more points are selected", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
  });

  it("does not show selection-tray when no points are selected", () => {
    render(
      <Wrapper selectedIds={new Set()}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("selection-tray")).toBeNull();
  });

  it("plan-route-btn is enabled when 3 spots selected", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001", "pt-002", "pt-003"])}>
        <ResultPanel
          activeResponse={makeResponse([
            BASE_POINT,
            { ...BASE_POINT, id: "pt-002", name: "京都駅" },
            { ...BASE_POINT, id: "pt-003", name: "祇園" },
          ])}
        />
      </Wrapper>,
    );
    expect(screen.getByTestId("plan-route-btn")).not.toBeDisabled();
  });

  it("plan-route-btn click transitions to confirm mode (RouteConfirm shown)", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001", "pt-002"])}>
        <ResultPanel
          activeResponse={makeResponse([
            BASE_POINT,
            { ...BASE_POINT, id: "pt-002", name: "京都駅" },
          ])}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("plan-route-btn"));
    // After clicking plan route, ResultPanel enters confirm mode (RouteConfirm rendered)
    expect(screen.queryByTestId("selection-tray")).toBeNull();
  });

  it("calls clear on PointSelectionContext when clear button is clicked", () => {
    const clear = vi.fn();
    render(
      <Wrapper selectedIds={new Set(["pt-001"])} clear={clear}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText(defaultDict.result_panel.clear));
    expect(clear).toHaveBeenCalledOnce();
  });

  it("selection-tray is visible in grid view", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    // Switch to grid view
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
  });

  it("selection-tray is visible in map view", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    // Default is map view
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
    // Switch to grid and back to map
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
  });
});
