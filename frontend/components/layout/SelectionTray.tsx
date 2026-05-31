"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, X, MapPin } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraySpot {
  id: string;
  name: string;
}

export interface SelectionTrayProps {
  spots: TraySpot[];
  onPlanRoute: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 6;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SpotChip({
  spot,
  index,
  label,
  onRemove,
}: {
  spot: TraySpot;
  index: number;
  label: string;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      data-chip
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {index + 1}
      </span>
      <span className="max-w-[120px] truncate">{spot.name}</span>
      <button
        type="button"
        aria-label={label}
        onClick={() => onRemove(spot.id)}
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function OverflowBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      data-testid="overflow-badge"
      className="flex shrink-0 items-center rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground"
    >
      +{count}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function EmptyPrompt({ text }: { text: string }) {
  return (
    <div
      data-testid="tray-empty-prompt"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <MapPin size={14} className="shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectionTray
// ---------------------------------------------------------------------------

export function SelectionTray({
  spots,
  onPlanRoute,
  onRemove,
  onClear,
  disabled = false,
}: SelectionTrayProps) {
  const { selection_tray: t, result_panel: rp } = useDict();
  const [collapsed, setCollapsed] = useState(false);

  const count = spots.length;
  const canPlanRoute = count >= 2 && !disabled;
  const visibleSpots = spots.slice(0, MAX_VISIBLE);
  const overflowCount = count - MAX_VISIBLE;

  const countText = t.count.replace("{count}", String(count));

  return (
    <div
      data-testid="selection-tray"
      data-tray="true"
      className="w-full overflow-x-hidden border-t border-border bg-card shadow-lg"
    >
      {/* Collapsed summary bar */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Collapse toggle */}
        <button
          type="button"
          data-testid="tray-collapse-btn"
          aria-label={collapsed ? t.expand : t.collapse}
          onClick={() => setCollapsed((prev) => !prev)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>

        {/* Count summary */}
        <span className="shrink-0 text-sm font-semibold text-foreground">
          {countText}
        </span>

        {/* Divider — only shown when chips are present */}
        {count > 0 && <span className="h-4 w-px bg-border" />}

        {/* Chips area */}
        <div
          data-testid="tray-chips-area"
          aria-hidden={collapsed ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden",
            collapsed && "sr-only h-0 overflow-hidden",
          )}
        >
          {count === 0 ? (
            <EmptyPrompt text={t.empty_prompt} />
          ) : (
            <>
              {visibleSpots.map((spot, i) => (
                <SpotChip
                  key={spot.id}
                  spot={spot}
                  index={i}
                  label={t.remove_chip.replace("{name}", spot.name)}
                  onRemove={onRemove}
                />
              ))}
              {overflowCount > 0 && (
                <OverflowBadge
                  count={overflowCount}
                  label={t.overflow_more.replace("{count}", String(overflowCount))}
                />
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {count > 0 && (
            <Button
              type="link"
              size="small"
              onClick={onClear}
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground"
            >
              {rp.clear}
            </Button>
          )}
          <button
            type="button"
            data-testid="plan-route-btn"
            disabled={!canPlanRoute}
            onClick={canPlanRoute ? onPlanRoute : undefined}
            aria-label={t.plan_route}
            className={cn(
              "animal-btn animal-btn-cta flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold",
              !canPlanRoute && "cursor-not-allowed opacity-50",
            )}
          >
            <MapPin size={14} />
            {t.plan_route}
          </button>
        </div>
      </div>
    </div>
  );
}
