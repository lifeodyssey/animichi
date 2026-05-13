"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { RuntimeResponse, PilgrimagePoint, SearchResultData } from "../../lib/types";
import { isSearchData, isRouteData } from "../../lib/types";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import { useDict } from "../../lib/i18n-context";
import { useSuggest } from "../../contexts/SuggestContext";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import RouteConfirm from "../generative/RouteConfirm";
import SpotDetail from "../generative/SpotDetail";
import { ResultPanelToolbar } from "./ResultPanelToolbar";
import type { FilterMode } from "./ResultPanelToolbar";
import { ResultPanelEmptyState } from "./ResultPanelEmptyState";
import { ResultPanelSkeleton } from "./ResultPanelSkeleton";
import { GridContent } from "./ResultGridContent";
import { FloatingSpotList } from "./FloatingSpotList";
import { SelectionBar } from "./SelectionBar";
import { MapViewToggle } from "./MapViewToggle";
import { epRangeLabel, buildEpRanges, buildAreasI18n, pointAreaI18n } from "./ResultPanelHelpers";
import { prewarmMapbox } from "../map/prewarm";

// Map — lazy-loaded with ssr:false (Mapbox GL requires window)

const LazyMap = dynamic(
  () => import("../map/BaseMap"),
  { ssr: false },
);

type ViewMode = "grid" | "map";

interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onRouteConfirmed?: (orderedIds: string[], origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

// No-results state

function NoResults() {
  const { grid: t } = useDict();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-sm text-muted-foreground">{t.no_results}</p>
    </div>
  );
}

// ResultPanel

export default function ResultPanel({
  activeResponse,
  onRouteConfirmed,
  defaultOrigin,
  loading,
}: ResultPanelProps) {
  const { result_panel: rp } = useDict();
  const onSuggest = useSuggest();
  const { selectedIds, toggle, clear } = usePointSelectionContext();
  const [view, setView] = useState<ViewMode>("map");
  const [filterMode, setFilterMode] = useState<FilterMode>("episode");
  const [activeEpRange, setActiveEpRange] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [detailPoint, setDetailPoint] = useState<PilgrimagePoint | null>(null);

  // Reset confirm mode and detail view when response changes (e.g. new search triggered).
  // Track prev response identity in state to trigger reset without useEffect + setState
  // or ref access during render.
  const [prevResponse, setPrevResponse] = useState(activeResponse);
  if (prevResponse !== activeResponse) {
    setPrevResponse(activeResponse);
    if (confirmMode) setConfirmMode(false);
    if (detailPoint !== null) setDetailPoint(null);
  }

  // Extract search points from the response (when available).
  const searchPoints = useMemo<PilgrimagePoint[]>(() => {
    if (!activeResponse || !isSearchData(activeResponse.data)) return [];
    return (activeResponse.data as SearchResultData).results.rows ?? [];
  }, [activeResponse]);

  // Selected points as full PilgrimagePoint[] objects (for RouteConfirm).
  const selectedPoints = useMemo<PilgrimagePoint[]>(
    () => searchPoints.filter((p) => selectedIds.has(p.id)),
    [searchPoints, selectedIds],
  );

  // Episode range filter chips — empty for movies (no episode data).
  const epRanges = useMemo(() => buildEpRanges(searchPoints), [searchPoints]);
  const hasEpisodes = epRanges.length > 0;

  // Area filter chips — derived from coordinates.
  const areas = useMemo(() => buildAreasI18n(searchPoints, rp.other_area), [searchPoints, rp.other_area]);

  // Default to area filter for movies (no episode data).
  const [prevHasEpisodes, setPrevHasEpisodes] = useState(hasEpisodes);
  if (prevHasEpisodes !== hasEpisodes) {
    setPrevHasEpisodes(hasEpisodes);
    if (!hasEpisodes && filterMode === "episode") setFilterMode("area");
  }

  // Filtered points based on active filter mode + selection.
  const visiblePoints = useMemo<PilgrimagePoint[]>(() => {
    if (filterMode === "episode") {
      if (activeEpRange === null) return searchPoints;
      return searchPoints.filter(
        (p) => p.episode != null && epRangeLabel(p.episode) === activeEpRange,
      );
    }
    if (activeArea === null) return searchPoints;
    return searchPoints.filter((p) => pointAreaI18n(p, rp.other_area) === activeArea);
  }, [searchPoints, filterMode, activeEpRange, activeArea, rp.other_area]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!activeResponse && loading) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <ResultPanelSkeleton />
      </section>
    );
  }

  // ── No active response (empty / welcome state) ────────────────────────────
  if (!activeResponse) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <ResultPanelEmptyState />
      </section>
    );
  }

  // ── Active response with search results ───────────────────────────────────
  if (isSearchData(activeResponse.data)) {
    // Prewarm Mapbox GL when results arrive — shaves ~800ms off first map render
    prewarmMapbox();
    const isEmpty = searchPoints.length === 0;

    // ── Confirm mode: show RouteConfirm instead of grid/map ──────────────
    if (confirmMode) {
      return (
        <section
          className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <RouteConfirm
            points={selectedPoints}
            defaultOrigin={defaultOrigin ?? ""}
            onConfirm={(ids, origin) => {
              setConfirmMode(false);
              onRouteConfirmed?.(ids, origin);
            }}
            onBack={() => setConfirmMode(false)}
          />
        </section>
      );
    }

    // ── Detail mode: show SpotDetail for a single point ─────────────────
    if (detailPoint) {
      return (
        <section
          className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <SpotDetail
            point={detailPoint}
            onBack={() => setDetailPoint(null)}
            onSelect={(id) => { toggle(id); setDetailPoint(null); }}
            isSelected={selectedIds.has(detailPoint.id)}
            nearbyPoints={searchPoints}
          />
        </section>
      );
    }

    // ── Map view ────────────────────────────────────────────────────────
    if (view === "map" && !isEmpty) {
      return (
        <section
          className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <div className="relative flex-1 overflow-hidden">
            {/* Map skeleton — shown while Mapbox GL JS initializes */}
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="animate-breathe">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="text-xs">{rp.map_loading}</span>
              </div>
            </div>

            {/* Mapbox GL map */}
            <LazyMap points={visiblePoints} selectedIds={selectedIds} onToggle={toggle} />

            {/* Floating spot list overlay — left side */}
            <FloatingSpotList
              points={searchPoints}
              visiblePoints={visiblePoints}
              selectedIds={selectedIds}
              onToggle={toggle}
              onPointClick={setDetailPoint}
              filterMode={filterMode}
              onFilterModeChange={setFilterMode}
              epRanges={epRanges}
              areas={areas}
              activeEpRange={activeEpRange}
              activeArea={activeArea}
              onEpRangeChange={setActiveEpRange}
              onAreaChange={setActiveArea}
              totalCount={searchPoints.length}
              hasEpisodes={hasEpisodes}
            />

            {/* View toggle overlay — top-right */}
            <MapViewToggle view={view} onViewChange={setView} />

            {/* Selection bar overlay — bottom */}
            {selectedIds.size > 0 && (
              <SelectionBar
                count={selectedIds.size}
                onPlanRoute={() => setConfirmMode(true)}
                onClear={clear}
                disabled={loading}
                hasFloatingList
              />
            )}
          </div>
        </section>
      );
    }

    // ── Grid view (or empty) ────────────────────────────────────────────
    return (
      <section
        className="entrance-slide-right relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      >
        {/* Toolbar: filter chips + view toggle */}
        <ResultPanelToolbar
          view={view}
          onViewChange={setView}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          epRanges={epRanges}
          activeEpRange={activeEpRange}
          onEpRangeChange={setActiveEpRange}
          areas={areas}
          activeArea={activeArea}
          onAreaChange={setActiveArea}
        />

        {/* Content area */}
        {isEmpty ? (
          <NoResults />
        ) : (
          <GridContent
            points={visiblePoints}
            selectedIds={selectedIds}
            onToggle={toggle}
            onDetail={setDetailPoint}
          />
        )}

        {/* Selection bar — bottom overlay for grid */}
        {selectedIds.size > 0 && (
          <SelectionBar
            count={selectedIds.size}
            onPlanRoute={() => setConfirmMode(true)}
            onClear={clear}
            disabled={loading}
          />
        )}
      </section>
    );
  }

  // ── Route results: full-bleed (no padding) for horizontal split layout ────
  if (isRouteData(activeResponse.data)) {
    return (
      <section
        className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <div className="flex-1 overflow-hidden">
          <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
        </div>
      </section>
    );
  }

  // ── Other response types: fall through to GenerativeUIRenderer ────────────
  // (QA, greet, etc.) — keep existing GenerativeUI path with padding.
  return (
    <section
      className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </section>
  );
}
