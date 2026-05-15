"use client";

import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";

type ViewMode = "grid" | "map";

interface MapViewToggleProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}

/**
 * Small pill overlay for top-right of map view.
 * Allows switching between grid and map views.
 */
export function MapViewToggle({ view, onViewChange }: MapViewToggleProps) {
  const { toolbar: t } = useDict();
  return (
    <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-lg bg-card p-0.5 shadow-md">
      <button
        type="button"
        onClick={() => onViewChange("map")}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150",
          view === "map"
            ? "bg-card text-foreground shadow-sm"
            : "bg-transparent text-muted-foreground",
        )}
      >
        {t.map}
      </button>
      <button
        type="button"
        onClick={() => onViewChange("grid")}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150",
          view === "grid"
            ? "bg-card text-foreground shadow-sm"
            : "bg-transparent text-muted-foreground",
        )}
      >
        {t.grid}
      </button>
    </div>
  );
}
