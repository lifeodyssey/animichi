"use client";

import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";
import { Button } from "@/components/ui/button";

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
    <div className="flex shrink-0 flex-col border-b-2 border-border bg-background">
      {/* Tab row: 按集数 | 按地区 + view toggle */}
      <div className="flex items-center gap-0 px-4 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterModeChange("episode")}
          className={cn(
            "min-h-[44px] rounded-none",
            tabClass(filterMode === "episode"),
          )}
        >
          {t.tab_episode}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterModeChange("area")}
          className={cn(
            "min-h-[44px] rounded-none",
            tabClass(filterMode === "area"),
          )}
        >
          {t.tab_area}
        </Button>

        <div className="flex-1" />

        {/* Grid / map pill toggle */}
        <div className="flex shrink-0 gap-0.5 rounded-lg bg-card p-0.5">
          <Button
            variant="chip"
            size="sm"
            aria-pressed={view === "grid"}
            onClick={() => onViewChange("grid")}
            className={cn(
              "gap-1.5",
              view === "grid"
                ? "bg-background text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground border-transparent shadow-none",
            )}
          >
            <span>📷</span>
            {t.grid}
          </Button>
          <Button
            variant="chip"
            size="sm"
            aria-pressed={view === "map"}
            onClick={() => onViewChange("map")}
            className={cn(
              "gap-1.5",
              view === "map"
                ? "bg-background text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground border-transparent shadow-none",
            )}
          >
            <span>🗺</span>
            {t.map}
          </Button>
        </div>
      </div>

      {/* Filter chips row */}
      {chips.length > 0 && (
        <div className="flex items-center gap-3 overflow-x-auto px-4 py-1.5">
          <Button
            variant="chip"
            size="xs"
            aria-pressed={activeChip === null}
            onClick={() => onChipChange(null)}
            className="shrink-0"
          >
            {t.all}
          </Button>
          {chips.map((chip) => (
            <Button
              variant="chip"
              size="xs"
              key={chip}
              aria-pressed={activeChip === chip}
              onClick={() => onChipChange(chip)}
              className="shrink-0"
            >
              {chip}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
