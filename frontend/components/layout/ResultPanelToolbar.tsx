"use client";

import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";

export type ViewMode = "grid" | "map";
export type FilterMode = "episode" | "area";

interface ResultPanelToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  filterMode: FilterMode;
  onFilterModeChange: (m: FilterMode) => void;
  /** Episode range chips (e.g. "EP 1-4", "EP 5-8") */
  epRanges: string[];
  activeEpRange: string | null;
  onEpRangeChange: (range: string | null) => void;
  /** Area chips (e.g. "宇治", "京都") */
  areas: string[];
  activeArea: string | null;
  onAreaChange: (area: string | null) => void;
}

function chipClass(active: boolean): string {
  return active
    ? "bg-primary text-background border-primary"
    : "bg-background text-muted-foreground border-border";
}

function tabClass(active: boolean): string {
  return active
    ? "text-foreground border-b-2 border-primary"
    : "text-muted-foreground border-b-2 border-transparent";
}

export function ResultPanelToolbar({
  view,
  onViewChange,
  filterMode,
  onFilterModeChange,
  epRanges,
  activeEpRange,
  onEpRangeChange,
  areas,
  activeArea,
  onAreaChange,
}: ResultPanelToolbarProps) {
  const { toolbar: t } = useDict();
  const chips = filterMode === "episode" ? epRanges : areas;
  const activeChip = filterMode === "episode" ? activeEpRange : activeArea;
  const onChipChange = filterMode === "episode" ? onEpRangeChange : onAreaChange;

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-background">
      {/* Tab row: 按集数 | 按地区 + view toggle */}
      <div className="flex items-center gap-0 px-4 pt-1">
        <button
          type="button"
          onClick={() => onFilterModeChange("episode")}
          className={cn(
            "min-h-[44px] px-3 py-2.5 text-xs font-medium transition-colors",
            tabClass(filterMode === "episode"),
          )}
        >
          {t.tab_episode}
        </button>
        <button
          type="button"
          onClick={() => onFilterModeChange("area")}
          className={cn(
            "min-h-[44px] px-3 py-2.5 text-xs font-medium transition-colors",
            tabClass(filterMode === "area"),
          )}
        >
          {t.tab_area}
        </button>

        <div className="flex-1" />

        {/* Grid / map pill toggle */}
        <div className="flex shrink-0 gap-0.5 rounded-lg bg-card p-0.5">
          <button
            type="button"
            onClick={() => onViewChange("grid")}
            className={cn(
              "flex min-h-[44px] items-center gap-1.5 rounded-md px-3.5 py-2.5 text-xs font-medium transition-all duration-150",
              view === "grid"
                ? "bg-background text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground",
            )}
          >
            <span>📷</span>
            {t.grid}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("map")}
            className={cn(
              "flex min-h-[44px] items-center gap-1.5 rounded-md px-3.5 py-2.5 text-xs font-medium transition-all duration-150",
              view === "map"
                ? "bg-background text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground",
            )}
          >
            <span>🗺</span>
            {t.map}
          </button>
        </div>
      </div>

      {/* Filter chips row */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-1.5">
          <button
            type="button"
            onClick={() => onChipChange(null)}
            className={cn(
              "shrink-0 rounded-[18px] border px-3 py-1 text-xs font-medium transition-all duration-150",
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
                "shrink-0 rounded-[18px] border px-3 py-1 text-xs font-medium transition-all duration-150",
                chipClass(activeChip === chip),
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
