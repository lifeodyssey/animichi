"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Drag handle — 2×3 grid of small dots
// ---------------------------------------------------------------------------

export function DragGrip() {
  return (
    <div
      className="flex shrink-0 cursor-grab flex-col gap-[3px] transition-opacity duration-150"
      style={{ color: "color-mix(in oklch, var(--color-primary) 25%, transparent)" }}
      aria-hidden
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-[3px]">
          <div className="h-[3px] w-[3px] rounded-full bg-current" />
          <div className="h-[3px] w-[3px] rounded-full bg-current" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable item
// ---------------------------------------------------------------------------

export interface SortableItemProps {
  point: PilgrimagePoint;
  index: number;
  onRemove: (id: string) => void;
}

export function SortableItem({ point, index, onRemove }: SortableItemProps) {
  const { route_confirm: t } = useDict();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? "0 4px 16px rgba(0,0,0,0.12)" : "none",
    zIndex: isDragging ? 10 : "auto" as const,
  };

  const displayName = point.name_cn ?? point.name;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-md border border-border bg-card px-5 py-3.5"
    >
      {/* Drag handle — Fix 8: always-visible grip, animated on hover */}
      <Button
        ghost
        size="small"
        className="animal-btn-icon-only grip-handle shrink-0 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <DragGrip />
      </Button>

      {/* Thumbnail */}
      {point.screenshot_url && (
        <img
          src={point.screenshot_url}
          alt=""
          width={48}
          height={36}
          className="h-9 w-12 shrink-0 rounded-sm object-cover"
          loading="lazy"
        />
      )}

      {/* Index + name + episode */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="shrink-0 text-sm text-muted-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {index + 1}.
        </span>
        <span
          className="truncate text-sm text-foreground font-display"
        >
          {displayName}
        </span>
        {typeof point.episode === "number" && point.episode > 0 && (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            EP {point.episode}
          </span>
        )}
      </div>

      {/* Remove button — always partially visible, full on hover/focus */}
      <Button
        ghost
        size="small"
        onClick={() => onRemove(point.id)}
        className="animal-btn-icon-only shrink-0 text-muted-foreground opacity-40 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`${t.remove_label} ${displayName}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Button>
    </div>
  );
}
