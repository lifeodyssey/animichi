"use client";

import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectionBarProps {
  count: number;
  onPlanRoute: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** When true, shifts left edge to account for floating spot list. */
  hasFloatingList?: boolean;
}

// ---------------------------------------------------------------------------
// SelectionBar — overlay bar shown when spots are selected
// ---------------------------------------------------------------------------

export function SelectionBar({
  count,
  onPlanRoute,
  onClear,
  disabled,
  hasFloatingList,
}: SelectionBarProps) {
  const { result_panel: rp } = useDict();

  return (
    <div
      data-testid="selection-bar"
      className={cn(
        "absolute bottom-3 right-3 z-20 flex items-center gap-3 rounded-lg bg-card px-4 py-2.5 shadow-lg",
        hasFloatingList ? "left-[232px]" : "left-3",
      )}
    >
      <span className="text-sm font-medium text-foreground">
        {rp.selected.replace("{count}", String(count))}
      </span>

      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {rp.clear}
      </button>

      <button
        type="button"
        onClick={onPlanRoute}
        disabled={disabled || count < 2}
        className="ml-auto flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {rp.plan_route}
      </button>
    </div>
  );
}
