"use client";

import Image from "next/image";
import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";
import type { PilgrimagePoint } from "../../lib/types";
import type { FilterMode } from "./ResultPanelToolbar";
import { SpotListEmpty } from "./SpotListEmpty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloatingSpotListProps {
  points: PilgrimagePoint[];
  visiblePoints: PilgrimagePoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onPointClick: (point: PilgrimagePoint) => void;
  activePointId?: string;
  filterMode: FilterMode;
  onFilterModeChange: (mode: FilterMode) => void;
  epRanges: string[];
  areas: string[];
  activeEpRange: string | null;
  activeArea: string | null;
  onEpRangeChange: (range: string | null) => void;
  onAreaChange: (area: string | null) => void;
  totalCount: number;
  /** False for movies — hides the episode filter tab. */
  hasEpisodes?: boolean;
  onRetry?: () => void;
  onRefine?: () => void;
}

// ---------------------------------------------------------------------------
// Chip style helpers
// ---------------------------------------------------------------------------

function chipClass(active: boolean): string {
  return active
    ? "bg-primary text-background border-primary"
    : "bg-background text-muted-foreground border-border";
}

// ---------------------------------------------------------------------------
// SpotThumb — thumbnail with broken-image fallback, stable 36×36 size
// ---------------------------------------------------------------------------

function SpotThumb({
  url,
  alt,
  index,
}: {
  url: string | null;
  alt: string;
  index: number;
}) {
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
        {index + 1}
      </div>
    );
  }

  return (
    <Image
      unoptimized
      src={url}
      alt={alt}
      width={36}
      height={36}
      loading="lazy"
      className="h-9 w-9 shrink-0 rounded-md object-cover"
      onError={() => setBroken(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// SpotItem — single row in the list
// ---------------------------------------------------------------------------

function SpotItem({
  point,
  index,
  selected,
  active,
  onToggle,
  onClick,
}: {
  point: PilgrimagePoint;
  index: number;
  selected: boolean;
  active: boolean;
  onToggle: (id: string) => void;
  onClick: (point: PilgrimagePoint) => void;
}) {
  return (
    <div
      data-testid={`spot-item-${point.id}`}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50",
        active && "bg-muted",
      )}
      onClick={() => onClick(point)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(point);
      }}
      role="button"
      tabIndex={0}
    >
      {/* Thumbnail */}
      <SpotThumb
        url={point.screenshot_url}
        alt={point.name_cn ?? point.name}
        index={index}
      />

      {/* Text */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-foreground">
          {index + 1}. {point.name_cn ?? point.name}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">
          {point.episode != null && point.episode > 0 ? `EP${point.episode} ` : ""}
          {point.title_cn ?? point.title ?? ""}
        </span>
      </div>

      {/* Checkbox */}
      <button
        type="button"
        aria-label={`Select ${point.name_cn ?? point.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(point.id);
        }}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          selected
            ? "border-primary bg-primary text-background"
            : "border-border bg-background text-transparent hover:border-primary/50",
        )}
      >
        {selected && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5L4 7L8 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FloatingSpotList
// ---------------------------------------------------------------------------

export function FloatingSpotList({
  visiblePoints,
  selectedIds,
  onToggle,
  onPointClick,
  activePointId,
  filterMode,
  onFilterModeChange,
  epRanges,
  areas,
  activeEpRange,
  activeArea,
  onEpRangeChange,
  onAreaChange,
  totalCount,
  hasEpisodes = true,
  onRetry,
  onRefine,
}: FloatingSpotListProps) {
  const { result_panel: rp, toolbar: t } = useDict();
  const activeRef = useRef<HTMLDivElement>(null);

  const chips = filterMode === "episode" ? epRanges : areas;
  const activeChip = filterMode === "episode" ? activeEpRange : activeArea;
  const onChipChange = filterMode === "episode" ? onEpRangeChange : onAreaChange;

  // Scroll active item into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activePointId]);

  return (
    <div
      data-testid="floating-spot-list"
      className="absolute bottom-3 left-3 top-3 z-10 flex w-[220px] flex-col overflow-hidden rounded-xl bg-card shadow-lg"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">
          {rp.spots_header}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {rp.spots_count.replace("{count}", String(totalCount))}
        </span>
      </div>

      {/* Filter tabs (compact) — episode tab hidden for movies */}
      <div className="flex shrink-0 items-center gap-0 border-b border-border px-2">
        {hasEpisodes && (
          <button
            type="button"
            onClick={() => onFilterModeChange("episode")}
            className={cn(
              "px-2 py-1.5 text-[10px] font-medium transition-colors",
              filterMode === "episode"
                ? "text-foreground border-b border-primary"
                : "text-muted-foreground",
            )}
          >
            {t.tab_episode}
          </button>
        )}
        <button
          type="button"
          onClick={() => onFilterModeChange("area")}
          className={cn(
            "px-2 py-1.5 text-[10px] font-medium transition-colors",
            filterMode === "area"
              ? "text-foreground border-b border-primary"
              : "text-muted-foreground",
          )}
        >
          {t.tab_area}
        </button>
      </div>

      {/* Filter chips row */}
      {chips.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5">
          <button
            type="button"
            onClick={() => onChipChange(null)}
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
              chipClass(activeChip === null),
            )}
          >
            {t.all}
          </button>
          {chips.map((chip) => (
            <button
              type="button"
              key={chip}
              onClick={() => onChipChange(chip)}
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                chipClass(activeChip === chip),
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable spot list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {visiblePoints.length === 0 ? (
          <SpotListEmpty onRetry={onRetry} onRefine={onRefine} />
        ) : (
          visiblePoints.map((point, idx) => (
            <div
              key={point.id}
              ref={point.id === activePointId ? activeRef : undefined}
            >
              <SpotItem
                point={point}
                index={idx}
                selected={selectedIds.has(point.id)}
                active={point.id === activePointId}
                onToggle={onToggle}
                onClick={onPointClick}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
