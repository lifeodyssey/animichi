"use client";

import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";

export interface CornerLabelProps {
  /** Which corner of the photo the label floats over. */
  side: "left" | "right";
  /** Colour register of the leading dot: anime (green) or real (teal). */
  tone: "anime" | "real";
  /** Label text (e.g. "Anime" / "Real"). */
  text: string;
  /** Optional position override (e.g. move a label clear of the fox). */
  className?: string;
  /** Optional pixel-match measurement tag → emitted as `data-measure` for scoring. */
  measure?: string;
}

/**
 * CornerLabel — a frosted corner badge floated over the comparison photo,
 * pairing a colour-coded dot with a short label. Built on the `corner` Pill
 * variant; positioning is layered on via className.
 */
export default function CornerLabel({ side, tone, text, className, measure }: CornerLabelProps) {
  return (
    <Pill
      variant="corner"
      data-measure={measure}
      className={cn("absolute top-3 z-10", side === "left" ? "left-3" : "right-3", className)}
    >
      <span
        className={cn("size-2 rounded-full", tone === "anime" ? "bg-success-fg" : "bg-primary")}
        aria-hidden="true"
      />
      {text}
    </Pill>
  );
}
